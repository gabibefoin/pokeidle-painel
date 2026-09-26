// O `/resgatar` no sim: entrega o prêmio de um marco de convites no jogador em memória.
//
// A regra (a escada, os prêmios, o formato do código) mora em `shared/convites.mjs`; a trava
// contra resgate duplo mora em `convites-db.mjs`, no banco. Aqui é só onde o prêmio encontra o
// jogador.
//
// ### A ordem, e por que ela é essa
//
//   1. o banco carimba o código e credita o diamante, numa transação (`convdb.resgatar`);
//   2. o resto do prêmio entra na memória do jogador;
//   3. o sim marca sujo, força o flush e só então carimba `entregue_em`.
//
// Entre o 1 e o 3 existe uma janela de alguns milissegundos em que o código está gasto e as
// 5.000 Beast Balls ainda não foram gravadas. Um processo que morra exatamente ali deixa a linha
// com `resgatado_em` e sem `entregue_em` — e o próximo login do jogador reentrega (ver
// `entregarPendentes`). É a mesma ideia da caixa postal dos pagamentos: o carimbo de "fez" e o
// de "entregou" são estados separados porque entre eles existe uma troca de dono do dado.
//
// ### Por que não entregar tudo pelo banco
//
// Bola, boost e VIP são colunas do jogador, e o dono do jogador em jogo é o sim (regra do
// arquivo de arquitetura). Escrevê-las direto no banco com o jogador online seria escrever
// contra o `flushJogadores`, que grava a partir da memória e passaria por cima no ciclo
// seguinte — o mesmo conflito que tirou `diamonds` do flush.
import { concederBoost } from './loja.mjs';
import * as convdb from '../convites-db.mjs';
import { BOLA_BEAST, VIP_PERMANENTE_ATE, marcoDe } from '../../shared/convites.mjs';

export { ErroConvite } from '../convites-db.mjs';

const HORA_MS = 60 * 60_000;
const DIA_MS = 24 * HORA_MS;

/**
 * Entrega UM prêmio no jogador em memória. Só prêmio vindo da escada de `shared/convites.mjs`
 * chega aqui — nenhum campo veio do cliente.
 *
 * O diamante NÃO passa por aqui: ele já foi creditado no ledger, dentro da transação do resgate.
 * O que este `case` faz é só atualizar o cache da tela.
 */
function entregar(p, premio, agora, saldoDiamantes) {
  switch (premio.tipo) {
    case 'diamante':
      if (saldoDiamantes != null) p.diamonds = saldoDiamantes;
      break;
    case 'bola':
      p.balls[premio.id] = (p.balls[premio.id] ?? 0) + premio.qtd;
      break;
    case 'item':
      p.items[premio.id] = (p.items[premio.id] ?? 0) + premio.qtd;
      break;
    case 'boost':
      // `concederBoost`, e não a compra: prêmio não gasta cota e estende do fim atual.
      concederBoost(p, premio.boost, premio.horas * HORA_MS, agora);
      break;
    case 'vip':
      p.vipAte = Math.max(p.vipAte ?? 0, agora) + premio.dias * DIA_MS;
      break;
    case 'vipPermanente':
      // Um instante tão longe que `agora < vipAte` nunca mais é falso. Ver `VIP_PERMANENTE_ATE`.
      p.vipAte = VIP_PERMANENTE_ATE;
      break;
    default:
      break;
  }
}

/** Entrega a lista inteira de um marco. Devolve os prêmios entregues, para a tela mostrar. */
function entregarMarco(p, premios, agora, saldoDiamantes = null) {
  for (const premio of premios) entregar(p, premio, agora, saldoDiamantes);
  return premios;
}

/**
 * O resgate. Carimba o código no banco, credita o diamante e entrega o resto em memória.
 *
 * NÃO marca o jogador sujo nem força o flush — quem chama faz isso e só então carimba
 * `entregue_em` com `confirmarEntrega`. A separação existe porque o sim é quem sabe quando a
 * gravação de fato terminou.
 *
 * @returns `{ codigo, marco, premios }`
 * @throws `ErroConvite` (`convite.invalido` | `convite.usado`)
 */
export async function resgatarCodigo(p, codigoBruto, agora = Date.now()) {
  const r = await convdb.resgatar({ codigo: codigoBruto, playerId: p.dbId });
  const premios = entregarMarco(p, r.premios, agora, r.saldoDiamantes);
  return { codigo: r.codigo, marco: r.marco, premios };
}

/** Carimba que a parte de JOGO do prêmio foi gravada. Chamado depois do flush. */
export const confirmarEntrega = (codigo) => convdb.marcarEntregue(codigo);

/**
 * A rede de segurança: reentrega no login o que ficou entre o resgate e o flush.
 *
 * Normalmente não faz nada — a consulta volta vazia e custa um índice parcial minúsculo. Quando
 * acha alguma coisa, entrega os prêmios de JOGO de novo (o diamante já está no ledger e não é
 * recreditado: `entregar` só atualiza o cache, e aqui não há saldo novo para atualizar).
 *
 * @returns os marcos reentregues, ou `[]`
 */
export async function entregarPendentes(p, agora = Date.now()) {
  if (!p.dbId) return [];
  const pendentes = await convdb.pendentesDoJogador(p.dbId);
  if (!pendentes.length) return [];
  const feitos = [];
  for (const { codigo, marco } of pendentes) {
    const m = marcoDe(marco);
    if (!m) continue;
    entregarMarco(p, m.premios, agora);
    feitos.push({ codigo, marco, premios: m.premios });
  }
  return feitos;
}

export { BOLA_BEAST };
