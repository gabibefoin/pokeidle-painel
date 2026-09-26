// O DOCUMENTO PARA MED — dos registros brutos ao conteúdo, sem tocar em banco nem em layout.
//
// ### Uma função pura, e por quê
//
// `montarDocumento` recebe o que `med-db.mjs` coletou e devolve uma LISTA DE BLOCOS (seção,
// parágrafo, tabela, campos, aviso…). O PDF (`med-pdf.mjs`) e a prévia HTML (`med-html.mjs`)
// desenham essa mesma lista — é isso que garante que a prévia conferida pelo administrador e o
// arquivo enviado ao banco tenham exatamente o mesmo conteúdo. Sem banco aqui dentro, o teste
// exercita cada regra com dados sintéticos (`tools/teste-med.mjs`).
//
// ### As três regras que não se negociam
//
// 1. **Nada é inventado.** Campo sem registro sai "Não disponível nos registros do sistema". O
//    rótulo de cada dado pessoal diz DE ONDE ele veio — o cadastro da conta não tem nome nem
//    CPF, e o documento não finge que tem.
// 2. **Nenhuma inconsistência é escondida.** O saldo é reconstruído do histórico e comparado ao
//    cadastro; o encadeamento é conferido linha a linha; pagamento sem crédito e crédito sem
//    pagamento viram aviso em destaque.
// 3. **Fato, não conclusão.** O texto automático só afirma o que um registro sustenta, e o que é
//    cálculo (a utilização mínima de cada compra) diz qual foi o critério.
//
// ### O hash
//
// SHA-256 do JSON de TODO o conteúdo (cabeçalho, identificação e blocos), com o próprio campo
// do hash trocado por um marcador. Mesmo registro → mesmo hash; um lançamento a mais, um
// centavo diferente ou outro administrador emitindo → outro hash.
import { createHash } from 'node:crypto';
import { textoImprimivel } from './pdf.mjs';

export const VERSAO_MODELO = 1;
export const NAO_DISPONIVEL = 'Não disponível nos registros do sistema';
export const RODAPE = 'Documento gerado automaticamente a partir dos registros eletrônicos disponíveis no sistema.';
export const TITULO = 'RELATÓRIO DE AUDITORIA — MED PIX';
const MARCADOR_HASH = '{{SHA-256}}';
const FUSO = 'America/Sao_Paulo';

// ------------------------------------------------------------------- formatos

const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const fmtData = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' });

export const dataHora = (iso) => (iso ? fmtDataHora.format(new Date(iso)).replace(', ', ' ') : NAO_DISPONIVEL);
export const data = (iso) => (iso ? fmtData.format(new Date(iso)) : NAO_DISPONIVEL);
const hora = (iso) => dataHora(iso).slice(11);
const diaIso = (dia) => { const [a, m, d] = String(dia).split('-'); return `${d}/${m}/${a}`; };

const inteiro = (v) => {
  const s = String(Math.abs(Math.trunc(Number(v) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return Number(v) < 0 ? `-${s}` : s;
};
const comSinal = (v) => (Number(v) > 0 ? `+${inteiro(v)}` : inteiro(v));
export const reais = (centavos) => {
  const c = Math.round(Number(centavos) || 0);
  const r = Math.trunc(Math.abs(c) / 100);
  const s = `R$ ${inteiro(r)},${String(Math.abs(c) % 100).padStart(2, '0')}`;
  return c < 0 ? `-${s}` : s;
};
const plural = (n, um, varios) => `${inteiro(n)} ${Number(n) === 1 ? um : varios}`;

export function cpfFormatado(cpf) {
  const d = String(cpf ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (cpf ? String(cpf) : null);
}

/** Troca endereços de e-mail em anotações livres — o de um membro da equipe não vai ao documento. */
const semEmails = (t) => String(t ?? '').replace(/[^\s@()<>]+@[^\s@()<>]+\.[^\s@()<>]+/g, 'administrador');

// ------------------------------------------------------------------- rótulos

const PROVEDOR = { efi: 'Efí', stripe: 'Stripe', livepix: 'LivePix' };
const METODO = { pix: 'PIX', cartao: 'Cartão de crédito' };
const STATUS_PAGAMENTO = { pago: 'Pago (confirmado)', pendente: 'Não pago (pendente)', expirado: 'Não pago (expirado)' };
const LOGIN = { local: 'E-mail e senha', google: 'Google', discord: 'Discord' };
const provedorDe = (p) => PROVEDOR[String(p ?? '').toLowerCase()] ?? (p || NAO_DISPONIVEL);
const metodoDe = (m) => METODO[m] ?? (m || NAO_DISPONIVEL);

/** O que cada motivo do livro-razão significa, em linguagem de quem não conhece o código. */
const MOTIVOS = {
  compra: { evento: 'CRÉDITO — COMPRA', origem: 'Compra de diamantes' },
  loja: { evento: 'UTILIZAÇÃO', origem: 'Loja do jogo' },
  loja_estorno: { evento: 'ESTORNO', origem: 'Loja do jogo — estorno automático' },
  voto: { evento: 'CRÉDITO — BRINDE', origem: 'Voto no site TopIdle' },
  afiliado: { evento: 'CRÉDITO — COMISSÃO', origem: 'Programa de indicação' },
  guild_global: { evento: 'CRÉDITO — PRÊMIO', origem: 'Ranking Global de guilds' },
  caixa_beta: { evento: 'CRÉDITO', origem: 'Abertura de Caixa de Fundador' },
  pesca_ressarcimento: { evento: 'CRÉDITO — RESSARCIMENTO', origem: 'Ressarcimento da Pesca (modo retirado)' },
  ajuste_admin: { evento: 'AJUSTE ADMINISTRATIVO', origem: 'Ajuste administrativo' },
  mercado_escrow: { evento: 'TRANSFERÊNCIA', origem: 'Mercado da Comunidade — reserva em anúncio' },
  mercado_devolucao: { evento: 'TRANSFERÊNCIA', origem: 'Mercado da Comunidade — anúncio cancelado' },
  mercado_compra: { evento: 'TRANSFERÊNCIA', origem: 'Mercado da Comunidade — compra de outro jogador' },
};
const motivoDe = (l) => {
  const m = MOTIVOS[l.motivo] ?? { evento: 'OUTRA OPERAÇÃO', origem: `Motivo "${l.motivo}"` };
  if (l.motivo === 'ajuste_admin') {
    return {
      evento: `AJUSTE ADMINISTRATIVO (${l.delta > 0 ? '+' : '-'})`,
      origem: l.ref === 'reset_beta' ? 'Encerramento do período beta' : m.origem,
    };
  }
  return m;
};

const BOOSTS = { xp: 'XP Boost', pokexp: 'XP Boost Pokémon', loot: 'Loot Boost', captura: 'Capture Boost', shiny: 'Shiny Secret Lure' };
const CATEGORIAS_JOGO = {
  npc: 'Lojas de NPC', market: 'Mercado', captura: 'Captura rara', refino: 'Refino', fragmento: 'Fragmentos',
  casa: 'Casas', caixa: 'Caixas de Fundador', tm: 'TM', evolucao: 'Evolução',
};
const ACOES_JOGO = {
  'npc.compra': ['compra', 'compras'], 'npc.venda_item': ['venda', 'vendas'], 'npc.venda_lote': ['venda em lote', 'vendas em lote'],
  'market.anunciado': ['anúncio', 'anúncios'], 'market.cancelado': ['cancelamento', 'cancelamentos'], 'market.comprado': ['compra', 'compras'],
};

// ------------------------------------------------------------------- solicitação

/**
 * Limpa o que o administrador digitou sobre a solicitação. Tudo opcional; o que vier inválido
 * é recusado com mensagem, em vez de entrar torto no documento.
 */
export function normalizarContexto(entrada = {}) {
  const texto = (v, max) => {
    const s = String(v ?? '').trim().replace(/\s+/g, ' ');
    if (s.length > max) throw new Error(`campo longo demais (máximo ${max} caracteres)`);
    return s || null;
  };
  let valorCentavos = null;
  const bruto = String(entrada.valorContestado ?? '').trim();
  if (bruto) {
    const limpo = bruto.replace(/[R$\s]/g, '');
    const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
    const v = Number(normal);
    if (!/^\d+(\.\d{1,2})?$/.test(normal) || !Number.isFinite(v)) throw new Error('valor contestado inválido (use 22,00)');
    valorCentavos = Math.round(v * 100);
  }
  let dataContestacao = null;
  const d = String(entrada.dataContestacao ?? '').trim();
  if (d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T12:00:00Z`))) {
      throw new Error('data da contestação inválida');
    }
    dataContestacao = d;
  }
  return {
    protocolo: texto(entrada.protocolo, 80),
    valorContestadoCentavos: valorCentavos,
    dataContestacao,
    instituicao: texto(entrada.instituicao, 120),
    pixId: texto(entrada.pixId, 80),
  };
}

const temContexto = (c) => !!(c && (c.protocolo || c.valorContestadoCentavos != null || c.dataContestacao || c.instituicao || c.pixId));

/**
 * Qual compra a solicitação contesta — e POR QUAL critério ela foi reconhecida.
 *
 * Pelo ID informado (E2E, txid ou id do provedor) quando existe. Sem ID, pelo valor, e só se
 * UM pagamento confirmado tiver exatamente aquele valor — dois iguais e o documento diz que não
 * dá para apontar. Sem solicitação nenhuma e com uma única compra na conta, é ela.
 */
export function identificarCompra(pagamentos, contexto) {
  const pagos = pagamentos.filter((p) => p.status === 'pago');
  const avisos = [];
  if (contexto?.pixId) {
    const alvo = contexto.pixId.toLowerCase();
    const achado = pagamentos.find((p) =>
      [p.comprovante, p.referencia, p.provedorRef].some((x) => x && String(x).toLowerCase() === alvo));
    if (achado) return { compra: achado, criterio: 'Identificada pelo ID da transação informado na solicitação', avisos };
    avisos.push(`O ID de transação informado (${contexto.pixId}) não corresponde a nenhum pagamento registrado para esta conta.`);
  }
  if (contexto?.valorContestadoCentavos != null) {
    const mesmos = pagos.filter((p) => p.centavos === contexto.valorContestadoCentavos);
    if (mesmos.length === 1) {
      return { compra: mesmos[0], criterio: 'Identificada pelo valor contestado (único pagamento confirmado com esse valor)', avisos };
    }
    avisos.push(mesmos.length
      ? `Há ${mesmos.length} pagamentos confirmados no valor contestado (${reais(contexto.valorContestadoCentavos)}); não é possível identificar a compra de forma inequívoca apenas pelo valor.`
      : `Nenhum pagamento confirmado desta conta tem o valor contestado (${reais(contexto.valorContestadoCentavos)}).`);
  }
  if (!temContexto(contexto) && pagos.length === 1) {
    return { compra: pagos[0], criterio: 'Única compra confirmada registrada na conta', avisos };
  }
  return { compra: null, criterio: null, avisos };
}

// ------------------------------------------------------------------- cálculos

/**
 * Reconciliação: o saldo reconstruído do histórico contra o do cadastro, mais as conferências
 * de integridade. Cada lançamento cai em EXATAMENTE uma linha — as seis somam o saldo.
 */
export function reconciliar(ledger, saldoRegistrado, pagamentos) {
  const linhas = {
    comprados: { n: 0, v: 0 }, outras: { n: 0, v: 0 }, admin: { n: 0, v: 0 },
    utilizados: { n: 0, v: 0 }, estornos: { n: 0, v: 0 }, removidos: { n: 0, v: 0 },
  };
  const porMotivo = new Map();
  let calculado = 0;
  const quebras = [];
  let anterior = 0;
  for (const l of ledger) {
    calculado += l.delta;
    let chave;
    if (l.motivo === 'compra') chave = 'comprados';
    else if (l.delta > 0) chave = l.motivo === 'loja_estorno' ? 'estornos' : l.motivo === 'ajuste_admin' ? 'admin' : 'outras';
    else chave = l.motivo === 'loja' ? 'utilizados' : 'removidos';
    linhas[chave].n += 1;
    linhas[chave].v += l.delta;

    const rotulo = l.motivo === 'ajuste_admin' ? `Ajuste administrativo (${l.delta > 0 ? 'crédito' : 'débito'})` : motivoDe(l).origem;
    const m = porMotivo.get(rotulo) ?? { n: 0, entradas: 0, saidas: 0 };
    m.n += 1;
    if (l.delta > 0) m.entradas += l.delta; else m.saidas += -l.delta;
    porMotivo.set(rotulo, m);

    if (l.saldoApos !== anterior + l.delta) quebras.push({ lancamento: l, esperado: anterior + l.delta });
    anterior = l.saldoApos;
  }

  const pagos = pagamentos.filter((p) => p.status === 'pago');
  const creditos = ledger.filter((l) => l.motivo === 'compra');
  const semCredito = pagos.filter((p) => !creditos.some((c) => c.ref === p.referencia && c.delta === p.qtd));
  const semPagamento = creditos.filter((c) => !pagos.some((p) => p.referencia === c.ref));
  const somaPagos = pagos.reduce((s, p) => s + p.qtd, 0);
  const ultimo = ledger.length ? ledger[ledger.length - 1].saldoApos : null;

  const verificacoes = [
    {
      nome: 'Saldo reconstruído pela soma das operações x saldo registrado no cadastro',
      ok: calculado === saldoRegistrado,
      detalhe: `${inteiro(calculado)} calculado · ${inteiro(saldoRegistrado)} registrado`,
    },
    {
      nome: 'Último saldo do livro-razão x saldo registrado no cadastro',
      ok: ultimo === null ? saldoRegistrado === 0 : ultimo === saldoRegistrado,
      detalhe: ultimo === null ? 'sem lançamentos' : `${inteiro(ultimo)} no último lançamento · ${inteiro(saldoRegistrado)} registrado`,
    },
    {
      nome: 'Encadeamento do saldo lançamento a lançamento',
      ok: quebras.length === 0,
      detalhe: quebras.length
        ? `${plural(quebras.length, 'quebra', 'quebras')}; a primeira em ${dataHora(quebras[0].lancamento.em)} (saldo registrado ${inteiro(quebras[0].lancamento.saldoApos)}, esperado ${inteiro(quebras[0].esperado)})`
        : `${plural(ledger.length, 'lançamento conferido', 'lançamentos conferidos')}`,
    },
    {
      nome: 'Pagamentos confirmados com crédito correspondente no livro-razão',
      ok: semCredito.length === 0,
      detalhe: semCredito.length
        ? `sem crédito: ${semCredito.map((p) => p.referencia).join(', ')}`
        : `${plural(pagos.length, 'pagamento', 'pagamentos')} com crédito de mesma quantidade`,
    },
    {
      nome: 'Créditos de compra com pagamento confirmado correspondente',
      ok: semPagamento.length === 0,
      detalhe: semPagamento.length
        ? `sem pagamento confirmado: ${semPagamento.map((c) => `${dataHora(c.em)} (${comSinal(c.delta)})`).join('; ')}`
        : plural(creditos.length, 'crédito de compra conferido', 'créditos de compra conferidos'),
    },
    {
      nome: 'Diamantes dos pagamentos confirmados x créditos de compra',
      ok: somaPagos === linhas.comprados.v,
      detalhe: `${inteiro(somaPagos)} nos pagamentos · ${inteiro(linhas.comprados.v)} creditados`,
    },
  ];

  return { linhas, porMotivo, calculado, saldoRegistrado, quebras, semCredito, semPagamento, verificacoes, divergenciaSaldo: !verificacoes[0].ok || !verificacoes[1].ok };
}

/**
 * Quanto de UMA compra foi, com certeza, usado — pelo critério que menos favorece a conclusão.
 *
 * Diamante não tem número de série: depois do crédito, não há registro de "qual" diamante saiu
 * em cada gasto. O cálculo então assume o pior caso para quem afirma o uso: a cada saída, o
 * saldo que já existia antes da compra e tudo o que entrou depois por outras origens são
 * gastos PRIMEIRO; só o que faltar sai do lote comprado. O resultado é um mínimo — o uso real
 * pode ter sido maior, nunca menor.
 */
export function consumoDaCompra(ledger, credito) {
  const idx = ledger.findIndex((l) => l.id === credito.id);
  if (idx < 0) return null;
  let outros = Math.max(0, credito.saldoApos - credito.delta);
  let lote = credito.delta;
  let naLoja = 0;
  let emOutras = 0;
  let esgotadoEm = null;
  for (let i = idx + 1; i < ledger.length && lote > 0; i++) {
    const l = ledger[i];
    if (l.delta > 0) { outros += l.delta; continue; }
    let sai = -l.delta;
    const deOutros = Math.min(outros, sai);
    outros -= deOutros;
    sai -= deOutros;
    const doLote = Math.min(lote, sai);
    if (doLote <= 0) continue;
    lote -= doLote;
    if (l.motivo === 'loja') naLoja += doLote; else emOutras += doLote;
    if (lote === 0) esgotadoEm = l.em;
  }
  return { qtd: credito.delta, saldoAnterior: Math.max(0, credito.saldoApos - credito.delta), naLoja, emOutras, restante: lote, esgotadoEm };
}

/** Cada compra da Loja com o seu estorno, se houve (mesmo produto, mesma quantidade, depois). */
function statusDasUtilizacoes(ledger) {
  const status = new Map();
  const abertas = [];
  for (const l of ledger) {
    if (l.motivo === 'loja') { abertas.push(l); status.set(l.id, null); }
    if (l.motivo === 'loja_estorno') {
      for (let i = abertas.length - 1; i >= 0; i--) {
        const a = abertas[i];
        if (a.ref === l.ref && -a.delta === l.delta) {
          status.set(a.id, l);
          abertas.splice(i, 1);
          break;
        }
      }
    }
  }
  return status;
}

function statusDaConta(conta) {
  if (!conta) return `${NAO_DISPONIVEL} (nenhuma conta de acesso vinculada ao personagem)`;
  if (!conta.ban) return 'Ativa (sem bloqueio registrado)';
  const motivo = conta.ban.motivo ? ` — motivo registrado: "${semEmails(conta.ban.motivo)}"` : '';
  return conta.ban.soft
    ? `Bloqueada (suspensão de acesso, progresso preservado) desde ${dataHora(conta.ban.em)}${motivo}`
    : `Banida (progresso reiniciado) desde ${dataHora(conta.ban.em)}${motivo}`;
}

const distintos = (lista) => [...new Set(lista.filter(Boolean))];

// ------------------------------------------------------------------- painel

/** O cartão do jogador na tela de busca — antes de emitir qualquer documento. */
export function resumoParaPainel(dados) {
  const { jogador: j, conta: c, pagamentos } = dados;
  const pagos = pagamentos.filter((p) => p.status === 'pago');
  return {
    nick: j.nick,
    playerId: j.id,
    contaId: c?.id ?? null,
    nomes: distintos(pagamentos.map((p) => p.nomePagador)),
    email: c?.email ?? null,
    emailsPagamento: distintos(pagamentos.map((p) => p.emailInformado)).filter((e) => e !== c?.email),
    cpfs: distintos(pagamentos.map((p) => cpfFormatado(p.cpf))),
    cpfIlegivel: pagamentos.some((p) => p.cpfIlegivel),
    contaCriadaEm: c?.criadaEm ?? null,
    personagemCriadoEm: j.criadoEm,
    status: statusDaConta(c),
    saldo: j.diamantes,
    comprasConfirmadas: pagos.length,
    totalCentavos: pagos.reduce((s, p) => s + p.centavos, 0),
    pagamentos: pagamentos.map((p) => ({
      referencia: p.referencia, comprovante: p.comprovante, provedorRef: p.provedorRef,
      qtd: p.qtd, centavos: p.centavos, metodo: metodoDe(p.metodo), provedor: provedorDe(p.provedor),
      status: STATUS_PAGAMENTO[p.status] ?? p.status, pago: p.status === 'pago',
      em: p.pagoEm ?? p.criadoEm,
    })),
  };
}

// ------------------------------------------------------------------- documento

/**
 * O documento inteiro.
 *
 * @param {object} p
 * @param {object} p.dados       o retorno de `coletarDados`
 * @param {object} p.empresa     o retorno de `dadosDaEmpresa`
 * @param {object} p.contexto    o retorno de `normalizarContexto` (ou vazio)
 * @param {{codigo:string, emitidoEm:string, porEmail:string}} p.emissao
 * @param {(id:string)=>({nome?:string, descricao?:string}|undefined)} [p.catalogo]
 */
export function montarDocumento({ dados, empresa, contexto = {}, emissao, catalogo = () => undefined }) {
  const T = (v) => (v == null || v === '' ? NAO_DISPONIVEL : textoImprimivel(String(v)));
  const { jogador: J, conta: C, pagamentos, ledger, origens, atividade, cobertura } = dados;
  const emitidoEm = emissao.emitidoEm;

  const pagos = pagamentos.filter((p) => p.status === 'pago');
  const naoPagos = pagamentos.filter((p) => p.status !== 'pago');
  const creditoDe = (p) => ledger.find((l) => l.motivo === 'compra' && l.ref === p.referencia) ?? null;
  const usosLoja = ledger.filter((l) => l.motivo === 'loja');
  const estornoDe = statusDasUtilizacoes(ledger);
  const rec = reconciliar(ledger, J.diamantes, pagamentos);
  const ident = identificarCompra(pagamentos, contexto);
  const foco = ident.compra;
  const creditoFoco = foco ? creditoDe(foco) : null;
  const temReset = ledger.some((l) => l.motivo === 'ajuste_admin' && l.ref === 'reset_beta');
  const nomes = distintos(pagamentos.map((p) => p.nomePagador));
  const cpfs = distintos(pagamentos.map((p) => cpfFormatado(p.cpf)));
  const produtoNome = (l) => T(l.nota || catalogo(l.ref)?.nome || l.ref);

  const blocos = [];
  let numero = 0;
  const secao = (titulo) => blocos.push({ t: 'secao', numero: ++numero, titulo });
  const paragrafo = (texto) => blocos.push({ t: 'paragrafo', texto: textoImprimivel(texto) });
  const subtitulo = (texto) => blocos.push({ t: 'subtitulo', texto });
  const nota = (texto) => blocos.push({ t: 'nota', texto: textoImprimivel(texto) });
  const aviso = (nivel, titulo, texto) => blocos.push({ t: 'aviso', nivel, titulo, texto: textoImprimivel(texto) });

  // Os números das seções são usados em referências cruzadas no texto; fixados aqui.
  const S = { resumo: 1, solicitacao: 2, cliente: 3, compras: 4, historico: 5, utilizacao: 6, produtos: 7, reconciliacao: 8, logs: 9, sobre: 10, declaracao: 11, auditoria: 12 };

  // ---------------------------------------------------------------- 1. resumo
  secao('RESUMO DA TRANSAÇÃO');
  const usadoAposFoco = creditoFoco ? usosLoja.filter((l) => l.id > creditoFoco.id) : [];
  if (foco) {
    const pix = foco.metodo === 'pix';
    blocos.push({
      t: 'campos', colunas: 2,
      itens: [
        { rotulo: 'Cliente', valor: nomes.length ? T(foco.nomePagador ?? nomes.join(' / ')) : NAO_DISPONIVEL },
        { rotulo: 'Nickname', valor: T(J.nick) },
        { rotulo: 'Data da compra', valor: dataHora(foco.pagoEm ?? foco.criadoEm) },
        { rotulo: 'Valor', valor: reais(foco.centavos) },
        { rotulo: 'Diamantes adquiridos', valor: inteiro(foco.qtd) },
        { rotulo: 'Diamantes utilizados na Loja após a compra', valor: inteiro(-usadoAposFoco.reduce((s, l) => s + l.delta, 0)) },
        { rotulo: 'Saldo restante (na emissão)', valor: inteiro(J.diamantes) },
        { rotulo: 'Status do pagamento', valor: STATUS_PAGAMENTO[foco.status] ?? T(foco.status) },
        { rotulo: 'Forma de pagamento', valor: metodoDe(foco.metodo) },
        { rotulo: 'Gateway', valor: provedorDe(foco.provedor) },
        { rotulo: 'ID da transação', valor: T(foco.provedor === 'stripe' ? foco.provedorRef : foco.referencia), mono: true },
        { rotulo: 'PIX ID (EndToEndId)', valor: pix ? T(foco.comprovante) : 'Não se aplica (pagamento por cartão)', mono: true },
      ],
    });
    nota(`Compra de referência: ${ident.criterio}.`);
  } else {
    const usadoTotal = -usosLoja.reduce((s, l) => s + l.delta, 0) - rec.linhas.estornos.v;
    blocos.push({
      t: 'campos', colunas: 2,
      itens: [
        { rotulo: 'Cliente', valor: nomes.length ? T(nomes.join(' / ')) : NAO_DISPONIVEL },
        { rotulo: 'Nickname', valor: T(J.nick) },
        { rotulo: 'Compras confirmadas', valor: inteiro(pagos.length) },
        { rotulo: 'Valor total pago', valor: reais(pagos.reduce((s, p) => s + p.centavos, 0)) },
        { rotulo: 'Diamantes adquiridos', valor: inteiro(pagos.reduce((s, p) => s + p.qtd, 0)) },
        { rotulo: 'Diamantes utilizados na Loja', valor: inteiro(usadoTotal) },
        { rotulo: 'Saldo restante (na emissão)', valor: inteiro(J.diamantes) },
        { rotulo: 'Formas de pagamento', valor: distintos(pagos.map((p) => metodoDe(p.metodo))).join(', ') || NAO_DISPONIVEL },
        { rotulo: 'Gateways', valor: distintos(pagos.map((p) => provedorDe(p.provedor))).join(', ') || NAO_DISPONIVEL },
        { rotulo: 'Período das compras', valor: pagos.length ? `${data(pagos[0].pagoEm)} a ${data(pagos[pagos.length - 1].pagoEm)}` : NAO_DISPONIVEL },
      ],
    });
    if (pagos.length > 1) nota(`A conta possui ${pagos.length} compras confirmadas; nenhuma foi apontada como objeto da solicitação. Todas estão detalhadas na seção ${S.compras}.`);
  }
  for (const a of ident.avisos) aviso('atencao', 'ATENÇÃO: compra da solicitação não identificada', a);

  subtitulo('Resumo automático dos registros');
  for (const texto of textoDoResumo()) paragrafo(texto);
  nota('Texto gerado automaticamente, com base exclusivamente nos registros apresentados nas seções seguintes.');

  function textoDoResumo() {
    const frases = [];
    const saldo = rec.divergenciaSaldo
      ? `Na data de emissão, o saldo registrado na conta é de ${plural(J.diamantes, 'diamante', 'diamantes')}. ATENÇÃO: o saldo reconstruído a partir do histórico de operações (${inteiro(rec.calculado)}) diverge do saldo registrado — ver seção ${S.reconciliacao}.`
      : `Na data de emissão, o saldo registrado na conta é de ${plural(J.diamantes, 'diamante', 'diamantes')}, e o saldo reconstruído a partir do histórico completo de operações coincide com o registrado.`;

    if (!pagos.length) {
      frases.push(`Não foram localizados pagamentos confirmados para a conta "${J.nick}".`);
      if (ledger.length) frases.push(`A conta possui ${plural(ledger.length, 'operação registrada', 'operações registradas')} de diamantes, de outras origens, detalhadas nas seções ${S.historico} e ${S.reconciliacao}.`);
      frases.push(saldo);
    } else if (foco && foco.status === 'pago') {
      frases.push(`Em ${data(foco.pagoEm)}, às ${hora(foco.pagoEm)} (horário de Brasília), consta a confirmação de pagamento via ${metodoDe(foco.metodo)}, processado pela ${provedorDe(foco.provedor)}, no valor de ${reais(foco.centavos)}, referente à aquisição de ${plural(foco.qtd, 'diamante', 'diamantes')} (créditos digitais internos da plataforma) pela conta "${J.nick}".`);
      if (creditoFoco) {
        const mesmo = foco.pagoEm && Math.abs(Date.parse(creditoFoco.em) - Date.parse(foco.pagoEm)) < 1000;
        frases.push(`O crédito de ${plural(creditoFoco.delta, 'diamante', 'diamantes')} foi lançado no livro-razão da conta ${mesmo ? 'no mesmo instante da confirmação' : `em ${dataHora(creditoFoco.em)}`} (saldo após o crédito: ${inteiro(creditoFoco.saldoApos)})${foco.entregue ? ', e o registro do pagamento está marcado como entregue à conta no jogo.' : ', e o registro do pagamento ainda não está marcado como entregue à sessão de jogo.'}`);
        if (usadoAposFoco.length) {
          const nomesUso = distintos(usadoAposFoco.map((l) => produtoNome(l)));
          frases.push(`Após o crédito, foram registradas ${plural(usadoAposFoco.length, 'utilização', 'utilizações')} de diamantes na Loja do jogo, totalizando ${plural(-usadoAposFoco.reduce((s, l) => s + l.delta, 0), 'diamante', 'diamantes')}, entre ${data(usadoAposFoco[0].em)} e ${data(usadoAposFoco[usadoAposFoco.length - 1].em)}, para aquisição de: ${nomesUso.join('; ')}.`);
        } else {
          frases.push('Após o crédito, não há registro de utilização de diamantes na Loja do jogo.');
        }
        const c = consumoDaCompra(ledger, creditoFoco);
        if (c && c.naLoja > 0) {
          let f = `Pelo critério conservador descrito na seção ${S.reconciliacao} (saldo anterior e créditos de outras origens considerados utilizados primeiro), ao menos ${inteiro(c.naLoja)} dos ${inteiro(c.qtd)} diamantes desta compra foram utilizados na Loja`;
          if (c.restante === 0 && c.emOutras === 0) f += `, tendo a quantidade adquirida sido integralmente utilizada até ${dataHora(c.esgotadoEm)}`;
          if (c.emOutras > 0) f += `, e ${inteiro(c.emOutras)} saíram da conta por outras operações registradas no histórico`;
          frases.push(`${f}.`);
        }
        const posteriores = ledger.filter((l) => l.id > creditoFoco.id && l.delta > 0);
        const ajustes = posteriores.filter((l) => l.motivo === 'ajuste_admin');
        const brindes = posteriores.filter((l) => l.motivo !== 'ajuste_admin');
        if (ajustes.length || brindes.length) {
          const partes = [];
          for (const l of ajustes.slice(0, 5)) {
            partes.push(`${comSinal(l.delta)} por ajuste administrativo em ${dataHora(l.em)}${l.nota ? `, com a anotação "${semEmails(l.nota)}"` : ''}`);
          }
          if (ajustes.length > 5) partes.push(`mais ${ajustes.length - 5} ajustes administrativos`);
          const porOrigem = new Map();
          for (const l of brindes) {
            const o = motivoDe(l).origem;
            const v = porOrigem.get(o) ?? { n: 0, v: 0 };
            v.n += 1; v.v += l.delta;
            porOrigem.set(o, v);
          }
          for (const [o, v] of porOrigem) partes.push(`${comSinal(v.v)} de "${o}" (${plural(v.n, 'operação', 'operações')})`);
          frases.push(`Após essa compra, a conta registrou também entradas de diamantes de outras origens: ${partes.join('; ')}.`);
        }
      } else {
        frases.push('ATENÇÃO: não foi localizado no livro-razão o lançamento de crédito correspondente a este pagamento (ver seção 8).');
      }
      const outras = pagos.filter((p) => p !== foco);
      if (outras.length) frases.push(`A conta possui ainda ${plural(outras.length, 'outra compra confirmada', 'outras compras confirmadas')}, detalhadas na seção ${S.compras}.`);
      frases.push(saldo);
    } else {
      const total = pagos.reduce((s, p) => s + p.centavos, 0);
      frases.push(`Constam ${plural(pagos.length, 'pagamento confirmado', 'pagamentos confirmados')} para a conta "${J.nick}", entre ${data(pagos[0].pagoEm)} e ${data(pagos[pagos.length - 1].pagoEm)}, totalizando ${reais(total)} e ${plural(pagos.reduce((s, p) => s + p.qtd, 0), 'diamante adquirido', 'diamantes adquiridos')}.`);
      if (usosLoja.length) frases.push(`A conta registra ${plural(usosLoja.length, 'utilização', 'utilizações')} de diamantes na Loja do jogo, totalizando ${plural(-usosLoja.reduce((s, l) => s + l.delta, 0), 'diamante', 'diamantes')}, entre ${data(usosLoja[0].em)} e ${data(usosLoja[usosLoja.length - 1].em)}.`);
      frases.push(saldo);
    }
    if (naoPagos.length) {
      const situacoes = distintos(naoPagos.map((p) => ({ pendente: 'pendente', expirado: 'expirada' })[p.status] ?? p.status)).join(', ');
      frases.push(naoPagos.length === 1
        ? `Consta também 1 cobrança não paga (situação: ${situacoes}), que não gerou crédito de diamantes.`
        : `Constam também ${inteiro(naoPagos.length)} cobranças não pagas (situação: ${situacoes}), que não geraram crédito de diamantes.`);
    }
    return frases;
  }

  // ---------------------------------------------------------------- 2. solicitação
  secao('DADOS DA SOLICITAÇÃO');
  if (temContexto(contexto)) {
    blocos.push({
      t: 'campos', colunas: 2,
      itens: [
        { rotulo: 'Protocolo MED', valor: contexto.protocolo ? T(contexto.protocolo) : 'Não informado' },
        { rotulo: 'Valor contestado', valor: contexto.valorContestadoCentavos != null ? reais(contexto.valorContestadoCentavos) : 'Não informado' },
        { rotulo: 'Data da contestação', valor: contexto.dataContestacao ? diaIso(contexto.dataContestacao) : 'Não informada' },
        { rotulo: 'Instituição solicitante', valor: contexto.instituicao ? T(contexto.instituicao) : 'Não informada' },
        { rotulo: 'ID PIX informado', valor: contexto.pixId ? T(contexto.pixId) : 'Não informado', mono: true },
        { rotulo: 'Compra correspondente nos registros', valor: foco ? `${dataHora(foco.pagoEm ?? foco.criadoEm)} · ${reais(foco.centavos)} · ${inteiro(foco.qtd)} diamantes` : 'Não identificada (ver avisos na seção 1)' },
      ],
    });
    nota('Os dados desta seção foram informados pelo administrador emissor a partir da solicitação recebida e não constituem registros do sistema. A correspondência com os registros é indicada no último campo.');
  } else {
    paragrafo('Nenhum dado de solicitação (protocolo, valor, instituição ou identificador PIX) foi informado na emissão deste documento.');
  }

  // ---------------------------------------------------------------- 3. cliente
  secao('DADOS DO CLIENTE');
  const linhasCliente = [
    ['Nome completo', nomes.length ? T(nomes.join(' / ')) : NAO_DISPONIVEL,
      'Nome do pagador devolvido pelo provedor de pagamento na confirmação da compra. O cadastro da conta não possui campo de nome.'],
    ['CPF', cpfs.length ? cpfs.join(' / ') : (pagamentos.some((p) => p.cpfIlegivel) ? 'Registro cifrado sem chave de leitura disponível' : NAO_DISPONIVEL),
      'Informado pelo titular no checkout do PIX e armazenado cifrado junto ao pagamento. O cadastro da conta não possui campo de CPF.'],
    ['E-mail', C?.email ? T(C.email) : NAO_DISPONIVEL, 'E-mail da conta de acesso.'],
  ];
  const emailsPag = distintos(pagamentos.map((p) => p.emailInformado)).filter((e) => e !== C?.email);
  if (emailsPag.length) linhasCliente.push(['E-mail nos pagamentos', T(emailsPag.join(' / ')), 'E-mail da sessão registrado no momento da compra.']);
  linhasCliente.push(
    ['Nickname', T(J.nick), 'Nome único do personagem.'],
    ['ID da conta', C ? `Conta de acesso nº ${C.id} · Personagem nº ${J.id}` : `Personagem nº ${J.id} (sem conta de acesso vinculada)`, 'Identificadores internos.'],
    ['Data de criação', C ? `Conta: ${dataHora(C.criadaEm)} · Personagem: ${dataHora(J.criadoEm)}` : `Personagem: ${dataHora(J.criadoEm)}`, 'Cadastro.'],
    ['Método de acesso', C ? (LOGIN[C.provedor] ?? T(C.provedor)) : NAO_DISPONIVEL, 'Cadastro da conta.'],
    ['E-mail confirmado', C ? (C.emailConfirmado ? 'Sim' : 'Não') : NAO_DISPONIVEL, 'Cadastro da conta.'],
    ['Status da conta', T(statusDaConta(C)), 'Registro de bloqueios.'],
    ['Último login registrado', C?.ultimoLogin ? dataHora(C.ultimoLogin) : NAO_DISPONIVEL, 'Cadastro da conta.'],
    ['Última atividade no jogo', dataHora(J.ultimaAtividade), 'Personagem.'],
  );
  blocos.push({
    t: 'tabela',
    colunas: [{ titulo: 'Campo', largura: 0.2 }, { titulo: 'Registro', largura: 0.42 }, { titulo: 'Fonte do registro', largura: 0.38 }],
    linhas: linhasCliente,
  });
  if (cpfs.length > 1) aviso('atencao', 'ATENÇÃO: CPFs diferentes', `Foram registrados ${cpfs.length} CPFs diferentes em pagamentos distintos desta conta.`);
  if (nomes.length > 1) aviso('info', 'Nomes de pagador diferentes', `Os pagamentos desta conta registram ${nomes.length} nomes de pagador diferentes.`);

  // ---------------------------------------------------------------- 4. compras
  secao('COMPRAS DE DIAMANTES');
  const identificadores = (p) => {
    const ids = [`ID interno${p.provedor === 'efi' ? ' / txid Efí' : ''}: ${p.referencia}`];
    if (p.provedor === 'stripe') ids.push(`Sessão Stripe: ${p.provedorRef ?? NAO_DISPONIVEL}`);
    else if (p.provedorRef) ids.push(`ID no provedor: ${p.provedorRef}`);
    if (p.status === 'pago') {
      const rotulo = p.metodo === 'pix' ? 'PIX ID (E2E)' : p.provedor === 'stripe' ? 'Pagamento Stripe' : 'Comprovante';
      ids.push(`${rotulo}: ${p.comprovante ?? NAO_DISPONIVEL}`);
    }
    return textoImprimivel(ids.join('\n'));
  };
  blocos.push({
    t: 'tabela',
    colunas: [
      { titulo: 'Data/Hora', largura: 0.15 },
      { titulo: 'Valor', largura: 0.08, alinhar: 'dir' },
      { titulo: 'Diamantes', largura: 0.085, alinhar: 'dir' },
      { titulo: 'Método / Gateway', largura: 0.09 },
      { titulo: 'Status', largura: 0.1 },
      { titulo: 'Identificadores', largura: 0.285, mono: true },
      { titulo: 'Observações', largura: 0.21 },
    ],
    linhas: pagamentos.map((p) => {
      const cred = creditoDe(p);
      const obs = [];
      if (p === foco) obs.push(temContexto(contexto) ? 'COMPRA OBJETO DA SOLICITAÇÃO' : 'COMPRA DE REFERÊNCIA DO RESUMO (seção 1)');
      obs.push(p.aceiteEm ? `Aceite das condições: ${dataHora(p.aceiteEm)}` : `Aceite das condições: ${NAO_DISPONIVEL}`);
      if (p.status === 'pago') {
        obs.push(cred ? `Crédito no livro-razão: ${comSinal(cred.delta)} (saldo ${inteiro(cred.saldoApos)})` : 'ATENÇÃO: crédito não localizado');
        obs.push(`Entregue à conta no jogo: ${p.entregue ? 'Sim' : 'Não'}`);
      } else {
        obs.push('Sem crédito de diamantes');
      }
      return [
        p.pagoEm ? `Criada: ${dataHora(p.criadoEm)}\nPaga: ${dataHora(p.pagoEm)}` : `Criada: ${dataHora(p.criadoEm)}`,
        reais(p.centavos),
        inteiro(p.qtd),
        `${metodoDe(p.metodo)}\n${provedorDe(p.provedor)}`,
        STATUS_PAGAMENTO[p.status] ?? T(p.status),
        identificadores(p),
        obs.join('\n'),
      ];
    }),
    destaques: pagamentos.map((p) => (p === foco ? 'foco' : p.status !== 'pago' ? 'fraco' : null)),
    vazio: 'Nenhum pagamento registrado para esta conta.',
    total: pagamentos.length
      ? ['Total pago', reais(pagos.reduce((s, p) => s + p.centavos, 0)), inteiro(pagos.reduce((s, p) => s + p.qtd, 0)), '', `${pagos.length} pago(s)`, '', `${naoPagos.length} cobrança(s) não paga(s)`]
      : null,
  });
  if (pagos.length) {
    subtitulo('Utilização dos diamantes de cada compra (critério conservador)');
    blocos.push({
      t: 'tabela',
      colunas: [
        { titulo: 'Compra', largura: 0.2 },
        { titulo: 'Diamantes', largura: 0.1, alinhar: 'dir' },
        { titulo: 'Saldo anterior', largura: 0.12, alinhar: 'dir' },
        { titulo: 'Utilizados na Loja (mínimo)', largura: 0.17, alinhar: 'dir' },
        { titulo: 'Saídas por outras operações', largura: 0.16, alinhar: 'dir' },
        { titulo: 'Situação da quantidade adquirida', largura: 0.25 },
      ],
      linhas: pagos.map((p) => {
        const cred = creditoDe(p);
        const c = cred ? consumoDaCompra(ledger, cred) : null;
        if (!c) return [`${dataHora(p.pagoEm)}\n${reais(p.centavos)}`, inteiro(p.qtd), '-', '-', '-', 'Crédito não localizado no livro-razão'];
        return [
          `${dataHora(p.pagoEm)}\n${reais(p.centavos)}`,
          inteiro(c.qtd),
          inteiro(c.saldoAnterior),
          inteiro(c.naLoja),
          inteiro(c.emOutras),
          c.restante === 0 ? `Integralmente utilizada até ${dataHora(c.esgotadoEm)}` : `Até ${inteiro(c.restante)} podem permanecer no saldo`,
        ];
      }),
      destaques: pagos.map((p) => (p === foco ? 'foco' : null)),
    });
    nota(`Critério: a cada saída de diamantes, considera-se que o saldo existente antes da compra e os créditos posteriores de outras origens foram utilizados primeiro; apenas o excedente é atribuído à compra. O valor é, portanto, o mínimo comprovado pelo histórico — ver seção ${S.reconciliacao}.`);
  }

  // ---------------------------------------------------------------- 5. histórico
  secao('HISTÓRICO DE DIAMANTES');
  paragrafo('Ordem cronológica. O histórico reúne os eventos de pagamento (cobrança gerada e pagamento confirmado) e todos os lançamentos do livro-razão de diamantes da conta, permitindo reconstruir o fluxo: pagamento, crédito de diamantes, saldo, utilização e produto recebido.');
  const eventos = [];
  for (const p of pagamentos) {
    const origem = `${metodoDe(p.metodo)} / ${provedorDe(p.provedor)}`;
    eventos.push({
      em: p.criadoEm, ordem: 0, id: 0,
      linha: [dataHora(p.criadoEm), p.status === 'pago' ? 'COBRANÇA GERADA' : 'COBRANÇA GERADA — NÃO PAGA', origem, '', '',
        `${reais(p.centavos)} · ${plural(p.qtd, 'diamante', 'diamantes')}${p.aceiteEm ? ' · aceite das condições registrado' : ''}${p.status !== 'pago' ? ` · ${STATUS_PAGAMENTO[p.status] ?? p.status}` : ''}`,
        p.referencia],
      destaque: p.status === 'pago' ? (p === foco ? 'foco' : null) : 'fraco',
    });
    if (p.status === 'pago' && p.pagoEm) {
      eventos.push({
        em: p.pagoEm, ordem: 1, id: 0,
        linha: [dataHora(p.pagoEm), 'PAGAMENTO CONFIRMADO', origem, '', '', `${reais(p.centavos)} recebido e confirmado junto ao provedor`,
          textoImprimivel(p.comprovante ? `${p.metodo === 'pix' ? 'E2E ' : ''}${p.comprovante}` : p.referencia)],
        destaque: p === foco ? 'foco' : null,
      });
    }
  }
  for (const l of ledger) {
    const m = motivoDe(l);
    let detalhe;
    if (l.motivo === 'compra') {
      const p = pagamentos.find((x) => x.referencia === l.ref);
      detalhe = p ? `Crédito da compra de ${reais(p.centavos)} (${metodoDe(p.metodo)} / ${provedorDe(p.provedor)})` : `Crédito de compra${l.nota ? ` · ${semEmails(l.nota)}` : ''} — pagamento não localizado`;
    } else if (l.motivo === 'loja') {
      detalhe = `"${produtoNome(l)}"`;
    } else if (l.motivo === 'loja_estorno') {
      detalhe = `Estorno de "${T(catalogo(l.ref)?.nome ?? l.ref)}"${l.nota ? ` · motivo: ${semEmails(l.nota)}` : ''}`;
    } else {
      detalhe = l.nota ? semEmails(l.nota) : '-';
    }
    eventos.push({
      em: l.em, ordem: 2, id: l.id,
      linha: [dataHora(l.em), m.evento, m.origem, comSinal(l.delta), inteiro(l.saldoApos), textoImprimivel(detalhe), T(l.ref ?? '-')],
      destaque: creditoFoco && l.id === creditoFoco.id ? 'foco' : rec.quebras.some((q) => q.lancamento.id === l.id) ? 'atencao' : null,
    });
  }
  eventos.sort((a, b) => Date.parse(a.em) - Date.parse(b.em) || a.ordem - b.ordem || a.id - b.id);
  blocos.push({
    t: 'tabela',
    colunas: [
      { titulo: 'Data/Hora', largura: 0.12 },
      { titulo: 'Evento', largura: 0.145 },
      { titulo: 'Origem', largura: 0.135 },
      { titulo: 'Diamantes', largura: 0.08, alinhar: 'dir' },
      { titulo: 'Saldo após', largura: 0.065, alinhar: 'dir' },
      { titulo: 'Detalhes', largura: 0.205 },
      { titulo: 'Identificador', largura: 0.25, mono: true },
    ],
    linhas: eventos.map((e) => e.linha),
    destaques: eventos.map((e) => e.destaque),
    vazio: 'Nenhuma movimentação de diamantes ou pagamento registrado para esta conta.',
  });
  nota(`Horários em horário de Brasília (UTC-03:00). "Identificador": referência interna do pagamento, código interno do produto ou referência registrada no lançamento. Linhas destacadas em azul correspondem à ${temContexto(contexto) ? 'compra objeto da solicitação' : 'compra de referência do resumo (seção 1)'}.`);

  // ---------------------------------------------------------------- 6. utilização
  secao('UTILIZAÇÃO DOS DIAMANTES');
  paragrafo('Todas as utilizações de diamantes na Loja do jogo, em ordem cronológica, com o produto ou benefício adquirido em cada uma.');
  blocos.push({
    t: 'tabela',
    colunas: [
      { titulo: 'Data/Hora', largura: 0.13 },
      { titulo: 'Quantidade', largura: 0.11, alinhar: 'dir' },
      { titulo: 'Produto', largura: 0.16 },
      { titulo: 'Código interno', largura: 0.16, mono: true },
      { titulo: 'Saldo após', largura: 0.07, alinhar: 'dir' },
      { titulo: 'Benefício (descrição do catálogo vigente)', largura: 0.37 },
    ],
    linhas: usosLoja.map((l) => [
      dataHora(l.em),
      `${inteiro(-l.delta)} diamantes`,
      produtoNome(l),
      T(l.ref),
      inteiro(l.saldoApos),
      catalogo(l.ref)?.descricao ? T(catalogo(l.ref).descricao) : 'Produto não consta no catálogo vigente',
    ]),
    destaques: usosLoja.map((l) => (estornoDe.get(l.id) ? 'fraco' : null)),
    vazio: 'Não há registro de utilização de diamantes na Loja do jogo.',
    total: usosLoja.length ? ['Total', `${inteiro(rec.linhas.utilizados.v * -1)} diamantes`, `${usosLoja.length} utilização(ões)`, '', '', rec.linhas.estornos.n ? `${rec.linhas.estornos.n} estorno(s), ${inteiro(rec.linhas.estornos.v)} diamantes devolvidos` : 'Sem estornos registrados'] : null,
  });
  nota('O nome do produto é o registrado no momento da utilização. A descrição do benefício é a do catálogo da Loja vigente na data de emissão deste documento.');

  // ---------------------------------------------------------------- 7. produtos
  secao('PRODUTOS/BENEFÍCIOS ADQUIRIDOS COM DIAMANTES');
  blocos.push({
    t: 'tabela',
    colunas: [
      { titulo: 'Data/Hora', largura: 0.15 },
      { titulo: 'Produto', largura: 0.22 },
      { titulo: 'Código', largura: 0.17, mono: true },
      { titulo: 'Diamantes utilizados', largura: 0.12, alinhar: 'dir' },
      { titulo: 'Saldo após', largura: 0.09, alinhar: 'dir' },
      { titulo: 'Status', largura: 0.25 },
    ],
    linhas: usosLoja.map((l) => {
      const e = estornoDe.get(l.id);
      return [dataHora(l.em), produtoNome(l), T(l.ref), inteiro(-l.delta), inteiro(l.saldoApos),
        e ? `Estornado em ${dataHora(e.em)}${e.nota ? ` (${T(semEmails(e.nota))})` : ''}` : 'Concluído (sem estorno registrado)'];
    }),
    destaques: usosLoja.map((l) => (estornoDe.get(l.id) ? 'fraco' : null)),
    vazio: 'Não há registro de produtos ou benefícios adquiridos com diamantes.',
  });
  if (usosLoja.length) {
    subtitulo('Resumo por produto');
    const porProduto = new Map();
    for (const l of usosLoja) {
      const k = `${l.ref}|${produtoNome(l)}`;
      const v = porProduto.get(k) ?? { nome: produtoNome(l), ref: l.ref, n: 0, qtd: 0, primeira: l.em, ultima: l.em };
      v.n += 1; v.qtd += -l.delta; v.ultima = l.em;
      porProduto.set(k, v);
    }
    blocos.push({
      t: 'tabela',
      colunas: [
        { titulo: 'Produto', largura: 0.27 }, { titulo: 'Código', largura: 0.19, mono: true },
        { titulo: 'Aquisições', largura: 0.1, alinhar: 'dir' }, { titulo: 'Diamantes', largura: 0.1, alinhar: 'dir' },
        { titulo: 'Primeira', largura: 0.17 }, { titulo: 'Última', largura: 0.17 },
      ],
      linhas: [...porProduto.values()].map((v) => [v.nome, T(v.ref), inteiro(v.n), inteiro(v.qtd), dataHora(v.primeira), dataHora(v.ultima)]),
    });
  }
  subtitulo('Situação dos benefícios na data de emissão');
  const agora = Date.parse(emitidoEm);
  const boostsAtivos = Object.entries(J.boosts ?? {})
    .filter(([, ate]) => Number(ate) > agora)
    .map(([k, ate]) => `${BOOSTS[k] ?? k} até ${dataHora(new Date(Number(ate)).toISOString())}`);
  blocos.push({
    t: 'campos', colunas: 1,
    itens: [
      { rotulo: 'VIP', valor: J.vipAte && J.vipAte > agora ? `Ativo até ${dataHora(new Date(J.vipAte).toISOString())}` : 'Sem VIP ativo na data de emissão' },
      { rotulo: 'Bônus temporários ativos', valor: boostsAtivos.length ? boostsAtivos.join('; ') : 'Nenhum bônus temporário ativo na data de emissão' },
    ],
  });
  nota('Estado atual do cadastro do personagem no momento da emissão; não representa, por si, o estado em datas anteriores.');
  if (temReset) {
    const r = ledger.find((l) => l.motivo === 'ajuste_admin' && l.ref === 'reset_beta');
    aviso('info', 'Encerramento do período beta', `Em ${dataHora(r.em)} consta o encerramento do período beta do jogo, que reiniciou o progresso das contas — incluindo itens, VIP e bônus ativos — e redefiniu o saldo de diamantes de cada conta para o total de diamantes comprados (acrescido do conteúdo de Caixas de Fundador abertas, quando houver). O ajuste correspondente aparece no histórico (seção ${S.historico}) e na reconciliação (seção ${S.reconciliacao}).`);
  }

  // ---------------------------------------------------------------- 8. reconciliação
  secao('RECONCILIAÇÃO DOS DIAMANTES');
  const L = rec.linhas;
  blocos.push({
    t: 'tabela',
    colunas: [{ titulo: 'Composição do saldo', largura: 0.66 }, { titulo: 'Operações', largura: 0.14, alinhar: 'dir' }, { titulo: 'Diamantes', largura: 0.2, alinhar: 'dir' }],
    linhas: [
      ['(+) Diamantes comprados', inteiro(L.comprados.n), comSinal(L.comprados.v)],
      ['(+) Diamantes recebidos por outras fontes', inteiro(L.outras.n), comSinal(L.outras.v)],
      ['(+) Diamantes adicionados manualmente por administradores', inteiro(L.admin.n), comSinal(L.admin.v)],
      ['(-) Diamantes utilizados na Loja', inteiro(L.utilizados.n), inteiro(L.utilizados.v)],
      ['(+) Estornos automáticos de utilizações na Loja', inteiro(L.estornos.n), comSinal(L.estornos.v)],
      ['(-) Diamantes removidos por outras operações', inteiro(L.removidos.n), inteiro(L.removidos.v)],
      ['(=) Saldo calculado a partir do histórico', inteiro(ledger.length), inteiro(rec.calculado)],
      ['Saldo registrado no cadastro da conta', '', inteiro(rec.saldoRegistrado)],
    ],
    destaques: [null, null, null, null, null, null, 'total', rec.divergenciaSaldo ? 'atencao' : 'total'],
  });
  if (rec.divergenciaSaldo) {
    aviso('atencao', 'ATENÇÃO: Foi identificada divergência entre o saldo calculado e o saldo registrado.',
      `Saldo calculado a partir do histórico: ${inteiro(rec.calculado)}. Saldo registrado no cadastro: ${inteiro(rec.saldoRegistrado)}. Diferença: ${comSinal(rec.saldoRegistrado - rec.calculado)}.`);
  } else {
    aviso('ok', 'Saldo conferido', `O saldo calculado a partir de ${plural(ledger.length, 'lançamento', 'lançamentos')} coincide com o saldo registrado no cadastro (${inteiro(rec.saldoRegistrado)}).`);
  }
  subtitulo('Detalhamento por origem');
  blocos.push({
    t: 'tabela',
    colunas: [{ titulo: 'Origem', largura: 0.44 }, { titulo: 'Operações', largura: 0.14, alinhar: 'dir' }, { titulo: 'Entradas', largura: 0.14, alinhar: 'dir' }, { titulo: 'Saídas', largura: 0.14, alinhar: 'dir' }, { titulo: 'Líquido', largura: 0.14, alinhar: 'dir' }],
    linhas: [...rec.porMotivo].map(([o, v]) => [o, inteiro(v.n), comSinal(v.entradas), v.saidas ? `-${inteiro(v.saidas)}` : '0', comSinal(v.entradas - v.saidas)]),
    vazio: 'Sem lançamentos.',
  });
  subtitulo('Verificações de integridade');
  blocos.push({
    t: 'tabela',
    colunas: [{ titulo: 'Verificação', largura: 0.45 }, { titulo: 'Resultado', largura: 0.13 }, { titulo: 'Detalhe', largura: 0.42 }],
    linhas: rec.verificacoes.map((v) => [v.nome, v.ok ? 'Confere' : 'DIVERGÊNCIA', textoImprimivel(v.detalhe)]),
    destaques: rec.verificacoes.map((v) => (v.ok ? null : 'atencao')),
  });
  for (const v of rec.verificacoes.slice(2)) {
    if (!v.ok) aviso('atencao', `ATENÇÃO: ${v.nome}`, v.detalhe);
  }
  subtitulo('Critério conservador de utilização por compra');
  paragrafo('Os diamantes de uma conta não carregam identificação individual: após o crédito, os registros não indicam qual unidade foi utilizada em cada operação. Para indicar quanto de cada compra foi utilizado, o sistema adota o critério menos favorável à afirmação de uso: a cada saída, considera-se que o saldo existente antes da compra e os créditos posteriores de outras origens foram utilizados primeiro, e apenas o excedente é atribuído à compra. O resultado apresentado na seção 4 é, portanto, a utilização mínima comprovada pelo histórico.');

  // ---------------------------------------------------------------- 9. logs
  secao('LOGS DE ACESSO RELEVANTES');
  subtitulo('Eventos de conta e de sessão');
  const ev = [];
  if (C?.criadaEm) ev.push([C.criadaEm, 'Conta de acesso criada', `Método de acesso: ${LOGIN[C.provedor] ?? T(C.provedor)}`, 'Registrado']);
  ev.push([J.criadoEm, 'Personagem criado', `Nickname: ${T(J.nick)}`, 'Registrado']);
  for (const p of pagamentos) {
    ev.push([p.criadoEm, 'Compra iniciada em sessão autenticada', `${metodoDe(p.metodo)} / ${provedorDe(p.provedor)} · ${reais(p.centavos)} · aceite das condições às ${p.aceiteEm ? hora(p.aceiteEm) : NAO_DISPONIVEL}`, p.status === 'pago' ? 'Cobrança paga' : (STATUS_PAGAMENTO[p.status] ?? T(p.status))]);
    if (p.status === 'pago' && p.pagoEm) ev.push([p.pagoEm, 'Pagamento confirmado pelo provedor', textoImprimivel(p.comprovante ? `ID: ${p.comprovante}` : `Referência: ${p.referencia}`), 'Confirmado']);
  }
  if (usosLoja.length) {
    ev.push([usosLoja[0].em, 'Primeira utilização de diamantes na Loja', `"${produtoNome(usosLoja[0])}"`, 'Concluída']);
    if (usosLoja.length > 1) ev.push([usosLoja[usosLoja.length - 1].em, 'Última utilização de diamantes na Loja', `"${produtoNome(usosLoja[usosLoja.length - 1])}"`, 'Concluída']);
  }
  if (C?.ban) ev.push([C.ban.em, 'Bloqueio da conta', C.ban.soft ? 'Suspensão de acesso' : 'Banimento', 'Registrado']);
  if (C?.ultimoLogin) ev.push([C.ultimoLogin, 'Último login registrado', '-', 'Sucesso']);
  if (J.ultimaAtividade) ev.push([J.ultimaAtividade, 'Última atividade do personagem', '-', 'Registrado']);
  ev.sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
  blocos.push({
    t: 'tabela',
    colunas: [{ titulo: 'Data/Hora', largura: 0.16 }, { titulo: 'Evento', largura: 0.27 }, { titulo: 'Detalhe', largura: 0.41 }, { titulo: 'Resultado', largura: 0.16 }],
    linhas: ev.map(([em, ...resto]) => [dataHora(em), ...resto]),
  });
  nota('A compra de diamantes só pode ser iniciada por sessão autenticada da conta, e as utilizações na Loja são comandos da sessão de jogo autenticada. O sistema não mantém registro individual de cada login: a conta guarda a data do último login, e a origem dos acessos é registrada conforme a tabela seguinte.');

  subtitulo('Origens de acesso (IP e dispositivo)');
  blocos.push({
    t: 'tabela',
    colunas: [{ titulo: 'Primeiro acesso', largura: 0.16 }, { titulo: 'Último acesso', largura: 0.16 }, { titulo: 'Acessos', largura: 0.08, alinhar: 'dir' }, { titulo: 'IP', largura: 0.22, mono: true }, { titulo: 'Dispositivo', largura: 0.24, mono: true }, { titulo: 'Primeiro evento', largura: 0.14 }],
    linhas: origens.map((o) => [dataHora(o.primeiroEm), dataHora(o.ultimoEm), inteiro(o.vezes), T(o.ip), T(o.dispositivo), o.evento === 'criar' ? 'Criação da conta' : o.evento === 'entrar' ? 'Login' : T(o.evento)]),
    vazio: cobertura.origensDesde
      ? `Nenhum registro de origem para esta conta. O registro de IP e dispositivo passou a ser gravado pelo sistema em ${data(cobertura.origensDesde)}; acessos anteriores a essa data não possuem esse registro.`
      : 'Nenhum registro de origem de acesso disponível no sistema.',
  });
  if (origens.length) nota(`Uma linha por combinação de IP e dispositivo, com a data do primeiro e do último acesso e o número de acessos. O identificador de dispositivo é um código aleatório gerado pelo navegador. Registro existente no sistema desde ${data(cobertura.origensDesde)}.`);

  subtitulo('Atividade registrada no jogo');
  const datasOps = [...ledger.map((l) => l.em), ...pagamentos.map((p) => p.criadoEm)].filter(Boolean).sort();
  const inicio = datasOps.length ? data(datasOps[0]) : data(J.criadoEm);
  const fim = datasOps.length ? data(datasOps[datasOps.length - 1]) : data(emitidoEm);
  const chaveDia = (s) => s.split('/').reverse().join('-');
  const noPeriodo = atividade.filter((a) => a.dia >= chaveDia(inicio) && a.dia <= chaveDia(fim));
  const porDia = new Map();
  for (const a of noPeriodo) {
    const v = porDia.get(a.dia) ?? { n: 0, categorias: new Map(), primeiro: a.primeiro, ultimo: a.ultimo };
    v.n += a.n;
    const cat = CATEGORIAS_JOGO[a.categoria] ?? a.categoria;
    const [um, varios] = ACOES_JOGO[`${a.categoria}.${a.acao}`] ?? [a.acao, a.acao];
    v.categorias.set(cat, [...(v.categorias.get(cat) ?? []), plural(a.n, um, varios)]);
    if (a.primeiro < v.primeiro) v.primeiro = a.primeiro;
    if (a.ultimo > v.ultimo) v.ultimo = a.ultimo;
    porDia.set(a.dia, v);
  }
  const LIMITE_DIAS = 60;
  const dias = [...porDia.entries()];
  blocos.push({
    t: 'tabela',
    colunas: [{ titulo: 'Dia', largura: 0.11 }, { titulo: 'Registros', largura: 0.09, alinhar: 'dir' }, { titulo: 'Ações registradas', largura: 0.5 }, { titulo: 'Primeiro', largura: 0.15 }, { titulo: 'Último', largura: 0.15 }],
    linhas: dias.slice(-LIMITE_DIAS).map(([dia, v]) => [diaIso(dia), inteiro(v.n), textoImprimivel([...v.categorias].map(([c, acoes]) => `${c}: ${acoes.join(', ')}`).join('; ')), hora(v.primeiro), hora(v.ultimo)]),
    vazio: 'Nenhuma ação de jogo registrada no período analisado.',
  });
  nota(`Período analisado: ${inicio} a ${fim} (do primeiro ao último evento de pagamento ou de diamantes da conta)${dias.length > LIMITE_DIAS ? `; exibidos os ${LIMITE_DIAS} dias mais recentes de ${dias.length}` : ''}. O registro de ações de jogo contempla categorias específicas (lojas de NPC, mercado, capturas raras, refino, casas e outras) e existe no sistema desde ${data(cobertura.atividadeDesde)}; a atividade comum de caça não gera registro individual.`);

  // ---------------------------------------------------------------- 10. sobre
  secao('SOBRE A PLATAFORMA');
  const dominio = String(empresa.site ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '') || NAO_DISPONIVEL;
  const operador = empresa.razaoSocial
    ? `, operado por ${empresa.razaoSocial}${empresa.cnpj ? ` (CNPJ ${empresa.cnpj})` : ''}`
    : '';
  const temMercado = ledger.some((l) => l.motivo.startsWith('mercado_'));
  paragrafo(`O PokeIdle (Pokéidle.io) é um jogo eletrônico online do gênero idle, jogado diretamente no navegador e disponibilizado através do domínio ${dominio}${operador}. No jogo, o usuário mantém um personagem cuja equipe de pokémon caça automaticamente no mapa, e pode interagir com outros jogadores por meio de chat, rankings, guilds, PvP e mercado entre jogadores.`);
  paragrafo('Sistema de contas. O acesso ao jogo exige uma conta registrada — por e-mail e senha, com confirmação do e-mail, ou por autenticação via Google ou Discord. Não existe acesso anônimo. Cada conta corresponde a um personagem identificado por um nome único (nickname), e as operações realizadas no jogo são vinculadas à conta autenticada que as executou.');
  paragrafo(`Diamantes. Os diamantes são créditos digitais internos da plataforma, adquiridos por pagamento via PIX (processado pela Efí) ou cartão de crédito (processado pela Stripe) e utilizados na Loja do jogo para a obtenção de benefícios e itens digitais. Os diamantes não são resgatáveis em dinheiro junto à plataforma. A conta pode ainda receber diamantes de outras origens, registradas separadamente no histórico (voto no site TopIdle, comissões do programa de indicação, premiações e ajustes administrativos). Diamantes adquiridos por compra também podem ser ofertados a outros jogadores no Mercado da Comunidade do jogo; essas movimentações aparecem no histórico como transferências.${temMercado ? '' : ' Na conta analisada não há movimentação de diamantes no Mercado da Comunidade.'}`);
  paragrafo('Produtos e benefícios. Na Loja do jogo, os diamantes podem ser utilizados, entre outros, em: assinatura VIP por período determinado (bônus de experiência, captura automática e traje exclusivo), bônus temporários (experiência, chance de captura, chance de pokémon shiny e itens), pokébolas, trajes (outfits), troca de nome e bênçãos.');
  paragrafo('Disponibilização após a compra. Para comprar, o usuário autenticado informa a quantidade de diamantes e marca o aceite das condições da compra apresentadas na tela; o valor é calculado pelo servidor e o instante do aceite é gravado junto ao pagamento. No PIX, a cobrança é registrada na Efí com identificador (txid) igual à referência interna do pagamento. O pagamento só é considerado confirmado após consulta do servidor à API do provedor; confirmado o pagamento, os diamantes são lançados no livro-razão da conta na mesma transação de banco de dados que marca o pagamento como pago, e o saldo é entregue à conta no jogo (registro "entregue").');
  paragrafo('Utilização. Ao adquirir um produto na Loja, o débito de diamantes é lançado no livro-razão antes da aplicação do benefício, com verificação de saldo pelo banco de dados. Nos produtos cuja entrega depende de condição verificada após o débito (troca de nome e Caixas de Fundador), uma falha na entrega gera estorno automático, também lançado no livro-razão.');
  paragrafo('Registro das operações. Toda movimentação de diamantes gera um lançamento no livro-razão de diamantes da conta, com data e hora, quantidade, saldo resultante, motivo e referência (código do produto ou identificador do pagamento). A aplicação não possui rotina de alteração de lançamentos já registrados, e o saldo da conta é conferido contra a soma desses lançamentos.');
  if (temReset) {
    paragrafo('Encerramento do período beta. O jogo passou por um período beta encerrado com um reinício geral: o progresso das contas (nível, itens, VIP e bônus ativos, entre outros) foi reiniciado e o saldo de diamantes de cada conta foi redefinido para o total de diamantes comprados, acrescido do conteúdo de Caixas de Fundador abertas. Os registros de pagamento e os lançamentos anteriores foram preservados, e a redefinição consta no livro-razão como ajuste administrativo.');
  }

  // ---------------------------------------------------------------- 11. declaração
  secao('DECLARAÇÃO SOBRE OS REGISTROS');
  const nomeEmpresa = empresa.razaoSocial ?? (empresa.cnpj ? `empresa inscrita no CNPJ ${empresa.cnpj}` : 'empresa emissora');
  paragrafo(`Este documento apresenta os registros eletrônicos disponíveis nos sistemas da ${nomeEmpresa} relacionados à conta identificada acima. As informações apresentadas foram obtidas diretamente dos registros internos de cadastro, transações, créditos digitais, utilização de recursos e demais logs disponíveis no momento da emissão deste documento.`);
  paragrafo('Os registros de transação apresentados neste documento correspondem aos eventos registrados pelo sistema e são apresentados em ordem cronológica para permitir a reconstrução do fluxo da operação. Os horários estão em horário de Brasília (UTC-03:00), conforme registrados pelos servidores da plataforma.');
  paragrafo('Informações indisponíveis nos registros são indicadas expressamente como tal. Os dados da seção 2, quando presentes, foram informados pelo emissor a partir da solicitação recebida e não constituem registros do sistema. Os cálculos apresentados (reconciliação e utilização mínima por compra) derivam exclusivamente dos lançamentos listados e têm seus critérios descritos no próprio documento.');
  paragrafo('Este documento tem caráter informativo e documental: compila fatos e registros eletrônicos, e não constitui parecer jurídico nem decisão sobre a solicitação a que se refere.');

  // ---------------------------------------------------------------- 12. auditoria
  secao('INFORMAÇÕES DE AUDITORIA');
  const contagens = {
    registros: pagamentos.length + ledger.length + origens.length + atividade.reduce((s, a) => s + a.n, 0) + (C ? 1 : 0) + 1,
    pagamentos: pagamentos.length,
    comprasConfirmadas: pagos.length,
    utilizacoes: usosLoja.length,
    operacoesDiamantes: ledger.length,
    origens: origens.length,
    registrosAtividade: atividade.reduce((s, a) => s + a.n, 0),
  };
  blocos.push({
    t: 'campos', colunas: 2,
    itens: [
      { rotulo: 'Documento', valor: emissao.codigo, mono: true },
      { rotulo: 'Documento gerado em', valor: dataHora(emitidoEm) },
      { rotulo: 'Administrador responsável', valor: T(emissao.porEmail) },
      { rotulo: 'Nickname consultado', valor: T(J.nick) },
      { rotulo: 'ID do personagem', valor: String(J.id) },
      { rotulo: 'ID da conta de acesso', valor: C ? String(C.id) : NAO_DISPONIVEL },
      { rotulo: 'Quantidade de registros encontrados', valor: inteiro(contagens.registros) },
      { rotulo: 'Quantidade de compras', valor: `${inteiro(pagos.length)} confirmada(s) de ${inteiro(pagamentos.length)} cobrança(s)` },
      { rotulo: 'Quantidade de utilizações', valor: inteiro(usosLoja.length) },
      { rotulo: 'Quantidade de operações de diamantes', valor: inteiro(ledger.length) },
      { rotulo: 'Registros de origem de acesso', valor: inteiro(origens.length) },
      { rotulo: 'Registros de ações de jogo', valor: inteiro(contagens.registrosAtividade) },
      { rotulo: 'Versão do modelo do documento', valor: String(VERSAO_MODELO) },
    ],
  });
  nota('Fontes consultadas: cadastro da conta e do personagem, registro de bloqueios, registro de pagamentos de diamantes, livro-razão de diamantes, registro de origens de acesso, registro de ações de jogo e catálogo da Loja.');
  blocos.push({ t: 'hash', rotulo: 'SHA-256 do conteúdo', valor: MARCADOR_HASH });
  nota('O hash é calculado sobre o conteúdo integral deste documento (textos, tabelas e dados de emissão), com este campo substituído por um marcador. O registro da emissão — com este hash e o hash do arquivo PDF gerado — fica armazenado nos sistemas da empresa e permite verificar posteriormente se o conteúdo ou o arquivo foi alterado.');

  // ---------------------------------------------------------------- envelope
  const empresaImpressa = {
    razaoSocial: empresa.razaoSocial ? textoImprimivel(empresa.razaoSocial) : NAO_DISPONIVEL,
    nomeFantasia: empresa.nomeFantasia ? textoImprimivel(empresa.nomeFantasia) : NAO_DISPONIVEL,
    cnpj: empresa.cnpj ?? NAO_DISPONIVEL,
    site: empresa.site ?? NAO_DISPONIVEL,
    email: empresa.email ?? NAO_DISPONIVEL,
    endereco: empresa.endereco ? textoImprimivel(empresa.endereco) : NAO_DISPONIVEL,
  };
  const identificacao = [
    { rotulo: 'Documento', valor: emissao.codigo },
    { rotulo: 'Emissão', valor: dataHora(emitidoEm) },
    { rotulo: 'Conta analisada', valor: T(J.nick) },
    { rotulo: 'Protocolo MED', valor: contexto?.protocolo ? T(contexto.protocolo) : 'Não informado' },
  ];
  const semHash = {
    versao: VERSAO_MODELO, titulo: TITULO, codigo: emissao.codigo, emitidoEm,
    empresa: empresaImpressa, identificacao, rodape: RODAPE, blocos,
  };
  const hash = createHash('sha256').update(JSON.stringify(semHash)).digest('hex');
  for (const b of blocos) if (b.t === 'hash') b.valor = hash;

  return {
    ...semHash,
    hash,
    contagens,
    nick: J.nick,
    playerId: J.id,
    contaId: C?.id ?? null,
    divergencia: rec.verificacoes.some((v) => !v.ok),
    compraIdentificada: foco ? { referencia: foco.referencia, criterio: ident.criterio } : null,
  };
}

/** Nome do arquivo: `MED_<nick>_<codigo>.pdf` — nunca CPF nem e-mail. */
export const nomeDoArquivo = (doc) =>
  `MED_${String(doc.nick).replace(/[^A-Za-z0-9_-]/g, '') || 'conta'}_${doc.codigo}.pdf`;
