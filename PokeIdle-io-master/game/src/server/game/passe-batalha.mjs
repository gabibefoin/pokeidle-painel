// O PASSE DE BATALHA no servidor: o estado de cada jogador, o resgate diário e a compra do VIP.
//
// ### Onde o estado mora, e por que ali
//
// Em `players.passe` (jsonb), carregado com o jogador e gravado pelo MESMO write-behind que grava
// o ouro, as bolas e os itens (`flushJogadores`). Isso é o que faz o resgate ser honesto num crash:
// o carimbo "resgatou hoje" e os prêmios que ele deu vão juntos para o banco, na mesma linha e na
// mesma transação. Numa tabela à parte, gravada na hora, um processo que caísse entre as duas
// gravações deixaria o dia marcado como pego e os prêmios perdidos (ou o contrário: prêmio duas
// vezes). É a regra do arquivo de arquitetura — quem é dono do dado manda nele, e o dono do
// jogador em jogo é o sim.
//
// A COMPRA do VIP é a exceção de sempre: o diamante é debitado no ledger, em transação, ANTES
// (`ddb.gastarNaLoja`, como toda compra da Loja), e só então o prazo entra na memória. Quem chama
// força um flush desse jogador logo depois — um passe pago não pode depender do ciclo de 5 s.
//
// ### A forma de `p.passe`
//
//   ultimo     o dia do passe (ver `diaDoPasse`) do último resgate, ou null
//   degrau     o degrau que esse resgate pegou (1..30)
//   ultimoVip  o dia do passe em que a parte VIP foi pega (ela pode vir depois da grátis: quem
//              compra o VIP depois de resgatar pega o VIP do dia na hora)
//   vipAte     até quando o Passe VIP vale (ms), ou 0
//   ciclos     quantas vezes o jogador fechou o Dia 30
//   total      resgates na vida
import { somarGoldAuditado } from '../audit-db.mjs';
import { concederBoost } from './loja.mjs';
import {
  PASSE_DIAS, PASSE_VIP_DIAS, PASSE_NIVEL_MIN, PASSE_VIP_PRECO,
  diaDoPasse, degrauDeHoje, degrauDaTrilha, normalizarPasse, vipAtivoNoPasse, estadoDoPasse,
} from '../../shared/passe-batalha.mjs';

export { normalizarPasse, estadoDoPasse };

const DIA_MS = 24 * 60 * 60_000;
const HORA_MS = 60 * 60_000;
/** Teto de VIP acumulado: comprar de novo estende, mas não além de 90 dias à frente. */
export const PASSE_VIP_TETO_MS = 90 * DIA_MS;

export { PASSE_VIP_PRECO };

export class ErroPasse extends Error {
  constructor(chave, params = {}) {
    super(chave);
    this.chave = chave;
    this.params = params;
  }
}

/**
 * Entrega UM prêmio no jogador em memória. Só o servidor chama, e só com prêmio da `TRILHA` —
 * nenhum campo daqui veio do cliente.
 */
function entregar(p, premio, agora, rotulo) {
  switch (premio.tipo) {
    case 'coins':
      somarGoldAuditado(p, premio.qtd, 'passe', rotulo, null, { sempre: true });
      break;
    case 'bola':
      p.balls[premio.id] = (p.balls[premio.id] ?? 0) + premio.qtd;
      break;
    case 'item':
      p.items[premio.id] = (p.items[premio.id] ?? 0) + premio.qtd;
      break;
    case 'boost':
      // `concederBoost`, e não a compra: prêmio não gasta a cota de ninguém, e estende do fim atual.
      concederBoost(p, premio.boost, premio.horas * HORA_MS, agora);
      break;
    case 'vip':
      p.vipAte = Math.max(p.vipAte ?? 0, agora) + premio.dias * DIA_MS;
      break;
    default:
      break;
  }
}

/**
 * O RESGATE do dia. Muda `p.passe` e entrega os prêmios em memória; quem chama marca o jogador
 * sujo e manda o estado.
 *
 * Dois casos dão prêmio:
 *   · o resgate do dia (grátis, mais o VIP se ele estiver valendo);
 *   · o VIP de HOJE para quem comprou o passe depois de já ter resgatado o grátis.
 *
 * @returns `{ degrau, premios: [{ ...premio, trilha: 'free'|'vip' }], quebrou, fechouCiclo }`
 * @throws `ErroPasse`
 */
export function resgatar(p, agora = Date.now()) {
  if (!p.admin && (p.level ?? 0) < PASSE_NIVEL_MIN) throw new ErroPasse('passe.nivelMin', { n: PASSE_NIVEL_MIN });
  const passe = normalizarPasse(p.passe);
  const st = degrauDeHoje(passe, agora);
  const hoje = diaDoPasse(agora);
  const vip = vipAtivoNoPasse(passe, agora);
  const premios = [];
  let fechouCiclo = false;

  if (!st.jaPegouHoje) {
    const d = degrauDaTrilha(st.degrau);
    for (const pr of d.free) premios.push({ ...pr, trilha: 'free' });
    if (vip) for (const pr of d.vip) premios.push({ ...pr, trilha: 'vip' });
    passe.ultimo = hoje;
    passe.degrau = st.degrau;
    if (vip) passe.ultimoVip = hoje;
    passe.total += 1;
    if (st.degrau >= PASSE_DIAS) {
      passe.ciclos += 1;
      fechouCiclo = true;
    }
  } else if (vip && passe.ultimoVip !== hoje) {
    const d = degrauDaTrilha(passe.degrau);
    for (const pr of d.vip) premios.push({ ...pr, trilha: 'vip' });
    passe.ultimoVip = hoje;
  } else {
    throw new ErroPasse('passe.jaPegou');
  }

  p.passe = passe;
  const degrau = passe.degrau;
  for (const pr of premios) entregar(p, pr, agora, `dia ${degrau} (${pr.trilha})`);
  return { degrau, premios, quebrou: st.quebrou, fechouCiclo };
}

/**
 * Confere se o jogador pode comprar o VIP AGORA — antes do débito, sem mexer em nada.
 * @throws `ErroPasse`
 */
export function podeComprarVip(p, agora = Date.now()) {
  if (!p.admin && (p.level ?? 0) < PASSE_NIVEL_MIN) throw new ErroPasse('passe.nivelMin', { n: PASSE_NIVEL_MIN });
  const passe = normalizarPasse(p.passe);
  const restante = Math.max(0, passe.vipAte - agora);
  if (restante + PASSE_VIP_DIAS * DIA_MS > PASSE_VIP_TETO_MS) {
    throw new ErroPasse('passe.vipTeto', { dias: Math.ceil(restante / DIA_MS) });
  }
  if ((p.diamonds ?? 0) < PASSE_VIP_PRECO) throw new ErroPasse('passe.semDiamantes', { n: PASSE_VIP_PRECO });
}

/** Liga (ou estende) o VIP depois do débito. Estende do fim atual, como o VIP da Loja. */
export function ativarVip(p, agora = Date.now()) {
  const passe = normalizarPasse(p.passe);
  passe.vipAte = Math.max(passe.vipAte, agora) + PASSE_VIP_DIAS * DIA_MS;
  p.passe = passe;
  return passe.vipAte;
}
