// A COMPRA das caixas do Market — o lado que cobra e entrega.
//
// A tabela e o sorteio moram em `shared/caixas-npc.mjs` (a tela mostra as mesmas chances antes do
// clique). Aqui está o que não pode estar lá: conferir o VIP, cobrar, sortear com o acaso do
// servidor e creditar.
//
// ### A ordem importa, e é esta
//
//   1. confere a caixa, o VIP e a quantidade;
//   2. COBRA O OURO, na mesma volta do laço em que confere o saldo;
//   3. cobra o DIAMANTE, no ledger — e devolve o ouro se ele recusar;
//   4. só então sorteia e credita.
//
// O ouro vem primeiro por causa de uma janela real. A versão anterior conferia o saldo, ia ao
// ledger (um `await`) e só depois descontava — e nesse `await` cabia OUTRA mensagem do mesmo
// jogador. A fila de economia não fecha essa porta: `amigo.coins`, por exemplo, gasta ouro fora
// dela. O roteiro era: 10.000.000 no bolso, pede dez caixas, manda 9.000.000 para um amigo
// enquanto o ledger responde e, na volta, `subtrairGold` — que faz clamp em 0 — tira o que
// sobrou. Dez caixas por um milhão.
//
// Com a cobrança antes do `await`, conferência e débito acontecem no mesmo bloco síncrono e não
// existe meio: ou o ouro saiu inteiro, ou a compra nem começou. E o retorno do débito é
// CONFERIDO (`cobrado !== custo.coins` recusa e estorna) — porque "cobrei o que deu" é
// exatamente a forma que o buraco tinha.
//
// Tudo isto roda dentro da fila de economia do jogador (ver o comando no `sim.mjs`): dois cliques
// em duas abas viram duas compras em sequência, nunca duas leituras do mesmo saldo.
import {
  abrirCaixas, agruparPremios, caixaPorId, custoDaCaixa, limitarQtdCaixa, melhorTier,
} from '../../shared/caixas-npc.mjs';
import { vipAtivo } from './loja.mjs';
import * as ddb from '../diamantes-db.mjs';

/** Recusa com chave de texto — a tela traduz (`caixa.recusa.*`). */
export class ErroCaixa extends Error {}

/**
 * Compra e abre caixas. Devolve `{ caixaId, qtd, custo, premios, tier, gold, diamonds }`.
 *
 * Uma caixa = um sorteio, sempre. `premios` vem AGRUPADO (`{ …, qtd somado, vezes }`), porque
 * abrir três mil caixas não pode virar três mil linhas no pacote: o que saiu cabe em dezesseis,
 * que é o tamanho da tabela. Com uma caixa só, a lista é idêntica à de antes.
 *
 * `debitarOuro`, `devolverOuro` e `auditar` entram por parâmetro porque são do `sim.mjs` — o ouro
 * do jogador vive na memória dele e quem sabe mexer nele (com auditoria) é de lá. Este módulo não
 * conhece o formato do jogador; ele conhece a regra da caixa.
 */
export async function comprarCaixa(p, msg, { debitarOuro, devolverOuro, auditar }) {
  const caixa = caixaPorId(msg?.caixaId);
  if (!caixa) throw new ErroCaixa('caixa.recusa.invalida');
  // O PORTÃO DO VIP. A tela já esconde o botão de quem não é VIP, mas quem manda é aqui: a caixa
  // VIP dobra a chance dos lendários, e isso não pode depender de o cliente ter sido honesto.
  if (caixa.vip && !vipAtivo(p, Date.now())) throw new ErroCaixa('caixa.recusa.soVip');

  const qtd = limitarQtdCaixa(msg?.qtd);
  const custo = custoDaCaixa(caixa.id, qtd);

  if ((p.gold ?? 0) < custo.coins) throw new ErroCaixa('caixa.recusa.semCoins');
  if (custo.diamantes > 0 && (p.diamonds ?? 0) < custo.diamantes) {
    // A conferência em memória é só cortesia (a tela já sabe): quem decide é o ledger abaixo.
    throw new ErroCaixa('caixa.recusa.semDiamantes');
  }

  // A COBRANÇA DO OURO, colada na conferência — sem `await` entre uma e outra, que é o que
  // impede outra mensagem do mesmo jogador de esvaziar a carteira no meio (ver o cabeçalho).
  const cobrado = debitarOuro(custo.coins);
  if (cobrado !== custo.coins) {
    // Cobrou menos do que a caixa vale: o saldo mudou embaixo da compra. Devolve o pedaço e
    // recusa — entregar a caixa aqui seria vendê-la pelo que sobrou na carteira.
    if (cobrado > 0) devolverOuro?.(cobrado);
    throw new ErroCaixa('caixa.recusa.semCoins');
  }

  if (custo.diamantes > 0) {
    try {
      const { saldo } = await ddb.gastarNaLoja({
        playerId: p.dbId,
        diamantes: custo.diamantes,
        produtoId: `caixa-${caixa.id}`,
        nome: `Caixa ${caixa.id === 'vip' ? 'Diamante VIP' : 'Free'} do Market ×${qtd}`,
      });
      p.diamonds = saldo;
    } catch {
      // O ledger recusou (saldo real menor que o da memória, transação perdida): o ouro volta
      // inteiro. É o único estorno do caminho, e ele é o motivo de o débito ser conferido acima.
      devolverOuro?.(cobrado);
      throw new ErroCaixa('caixa.recusa.semDiamantes');
    }
  }

  // Daqui para baixo não há mais `await`: o sorteio acontece e os prêmios entram na mesma volta
  // do laço de eventos. Ninguém vê o jogador com o ouro debitado e sem a caixa.
  //
  // O sorteio continua sendo UM por caixa — mil caixas, mil sorteios independentes. O que é
  // agrupado é só o RELATO: mil linhas iguais no pacote (e na auditoria) seriam mil objetos por
  // uma informação que cabe em dezesseis.
  const premios = agruparPremios(abrirCaixas(caixa.id, qtd) ?? []);
  for (const premio of premios) {
    if (premio.tipo === 'bola') p.balls[premio.id] = (p.balls[premio.id] ?? 0) + premio.qtd;
    else p.items[premio.id] = (p.items[premio.id] ?? 0) + premio.qtd;
  }

  auditar(
    `Caixa ${caixa.id} ×${qtd} · −${cobrado.toLocaleString('pt-BR')} coins`
      + (custo.diamantes ? ` · −${custo.diamantes} diamantes` : '')
      + ` · ${premios.map((x) => `${x.tipo}:${x.id}×${x.qtd}`).join(', ') || 'nada'}`,
    `caixa:${caixa.id}:${qtd}`,
  );

  return {
    caixaId: caixa.id,
    qtd,
    custo: { coins: cobrado, diamantes: custo.diamantes },
    premios,
    tier: melhorTier(premios),
    gold: p.gold,
    diamonds: p.diamonds,
  };
}
