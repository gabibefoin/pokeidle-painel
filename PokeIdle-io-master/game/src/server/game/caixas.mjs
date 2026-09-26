// As REGRAS das Caixas de Fundador — o que a Loja vende, quando abre e o que a tela mostra.
//
// A persistência mora em `caixas-db.mjs`; o que está aqui é a parte sem banco: o catálogo que
// entra na vitrine, a data de abertura da venda, e as duas funções que o sim usa para manter
// o jogador coerente (outfit no armário, tag no chat).
//
// Ver o cabeçalho de `shared/caixas-beta.mjs` para o desenho do produto.
import {
  CAIXAS_BETA,
  CAIXAS_ABREM_EM,
  COMPRAS_POR_JOGADOR,
  LISTA_CAIXAS,
  LOOKTYPES_CAIXA_BETA,
  caixaPorTipo,
  melhorTag,
  tagDoLooktype,
} from '../../shared/caixas-beta.mjs';

/**
 * Quando a venda abre. `CAIXAS_BETA_ABREM` no `.env` manda, e o padrão é a data do lançamento
 * (ver `CAIXAS_ABREM_EM`).
 *
 * Aceita ISO (`2026-09-07T03:00:00Z`) ou o carimbo em ms. Valor ilegível cai no padrão em vez
 * de virar `NaN` — um `NaN` aqui deixaria a comparação `agora >= abre` sempre falsa e a caixa
 * nunca abriria, calada.
 */
function lerAbertura() {
  const bruto = process.env.CAIXAS_BETA_ABREM;
  if (!bruto) return CAIXAS_ABREM_EM;
  const n = Number(bruto);
  const ms = Number.isFinite(n) && n > 0 ? n : Date.parse(bruto);
  if (!Number.isFinite(ms)) {
    console.warn(`[caixas] CAIXAS_BETA_ABREM inválido (${bruto}) — usando a data padrão`);
    return CAIXAS_ABREM_EM;
  }
  return ms;
}

export const CAIXAS_ABREM = lerAbertura();

/** A venda já começou? Quem pergunta é o servidor; a tela só desenha a contagem. */
export const vendaAberta = (agora = Date.now()) => agora >= CAIXAS_ABREM;

/**
 * Os produtos da Loja.
 *
 * Entram no catálogo com `caixaBeta: true`, que é o que faz a vitrine desenhar o card
 * especial (o baú, o que vem dentro e o contador de restantes) em vez do card comum.
 *
 * `efeito` fica de fora de propósito: o efeito de uma caixa não é uma mudança no jogador, é
 * uma LINHA NOVA numa tabela com número irrepetível, e isso não cabe no `aplicarEfeito`
 * síncrono da loja. Quem trata é o `loja.comprar` no sim, pelo desvio de `caixaPorProduto`.
 */
export const produtosDeCaixa = () =>
  LISTA_CAIXAS.map((c) => ({
    id: c.produtoId,
    cat: 'caixas',
    grupo: 'caixas',
    nome: c.nome,
    preco: c.preco,
    icone: `/img/itens/caixa-${c.tipo}.png`,
    caixaBeta: c.tipo,
    looktypeCaixa: c.looktype,
    diamantesCaixa: c.diamantes,
    limiteCaixa: c.limite,
    corCaixa: c.cor,
    tagCaixa: c.tag,
  }));

/**
 * Reconcilia o armário com o que a pessoa abriu de fato.
 *
 * Roda no login. A outfit de caixa NÃO é gravada pela transação de abertura (ver a nota em
 * `abrirCaixa`), então o direito a ela é derivado da tabela: quem tem caixa aberta daquele
 * tipo tem a outfit, ponto. Isto aqui só espelha esse direito no `ownedOutfits`, que é o que
 * o Armário desenha.
 *
 * É idempotente e barato — uma varredura de duas entradas — e é o que faz a outfit sobreviver
 * a um processo que caia entre a abertura e o flush seguinte.
 *
 * @returns true se mudou alguma coisa (o chamador marca o jogador como sujo)
 */
export function sincronizarOutfitsDeCaixa(p, tags) {
  const donas = new Set();
  for (const tag of tags ?? []) {
    const def = caixaPorTipo(tag.tipo);
    if (def) donas.add(def.looktype);
  }
  const atual = (p.ownedOutfits ??= []);
  let mudou = false;
  // Tira looktypes de caixa que ficaram no flush mas a tag sumiu (limpeza de teste no banco).
  for (let i = atual.length - 1; i >= 0; i--) {
    if (LOOKTYPES_CAIXA_BETA.has(atual[i]) && !donas.has(atual[i])) {
      atual.splice(i, 1);
      mudou = true;
    }
  }
  for (const lt of donas) {
    if (!atual.includes(lt)) {
      atual.push(lt);
      mudou = true;
    }
  }
  return mudou;
}

/**
 * Pode vestir esta outfit de caixa?
 *
 * Conferido contra as TAGS (as caixas abertas), e não contra `ownedOutfits`: a lista em
 * memória é conveniência de tela, e um `loja.equipar` forjado não deve conseguir vestir uma
 * outfit só porque a lista foi contaminada por um caminho qualquer.
 */
export function podeVestirOutfitDeCaixa(p, looktype) {
  if (!LOOKTYPES_CAIXA_BETA.has(Number(looktype))) return false;
  return (p.caixaTags ?? []).some((t) => caixaPorTipo(t.tipo)?.looktype === Number(looktype));
}

/**
 * Este jogador ainda pode comprar este tipo na LOJA?
 *
 * Pré-checagem barata, em memória, para a vitrine desenhar "Já comprada" em vez de deixar o
 * jogador clicar e levar um "não" depois do débito. A palavra final é do banco, dentro da
 * transação que numera (ver `comprarCaixa`) — que é quem fecha a corrida de dois cliques.
 */
export function podeComprarNaLoja(p, tipo) {
  return (p.caixasCompradas?.[tipo] ?? 0) < COMPRAS_POR_JOGADOR;
}

/** O que vai no estado do jogador — a bolsa de caixas, as tags e a régua da venda. */
export function caixasParaCliente(p, vendidas) {
  return {
    // As caixas FECHADAS na mão dele (as abertas viraram tag e outfit).
    minhas: p.caixas ?? [],
    // Todas as tags conquistadas: o Armário e a Ficha mostram a coleção inteira.
    tags: p.caixaTags ?? [],
    // A que o chat mostra: a do que ele está VESTINDO. Trocar de skin no Armário troca a tag
    // (ver `tagDoLooktype`) — o gateway lê este campo de carona no snapshot e carimba a
    // próxima mensagem com ela.
    tag: tagDoLooktype(p.caixaTags, p.looktype),
    // Quantas de cada tipo ele já comprou NO BALCÃO. A vitrine usa para trocar o preço por
    // "Já comprada" — o teto é 1 por tipo (`COMPRAS_POR_JOGADOR`).
    compradas: p.caixasCompradas ?? {},
    porJogador: COMPRAS_POR_JOGADOR,
    vendidas: vendidas ?? {},
    abremEm: CAIXAS_ABREM,
    aberta: vendaAberta(),
  };
}

export { CAIXAS_BETA, LISTA_CAIXAS, COMPRAS_POR_JOGADOR, melhorTag, tagDoLooktype };
