// O worker que efetivamente MANDA o dinheiro.
//
// Separado do tick do jogo de propósito: o tick roda 4×/s e não pode esperar rede nenhuma,
// e um saque leva de centenas de milissegundos a minutos. Aqui é um laço lento, com uma
// transação por vez, e ele é a única coisa no sistema autorizada a assinar uma transferência.
//
// ### A regra de ouro: NUNCA reenviar sem antes olhar a blockchain
//
// O risco não é o saque falhar — é ele ter dado certo sem a gente saber. Timeout de RPC, nó
// dessincronizado, processo morto entre o broadcast e a resposta: em qualquer um desses casos
// a transação pode estar confirmada enquanto o nosso banco a marcou como `falhou`. Reenviar
// em cima disso paga o jogador duas vezes, e transferência em blockchain não volta.
//
// Por isso todo reenvio passa por `reconferir()` ANTES de assinar qualquer coisa:
//
//     hash antigo confirmada?  → marca CONFIRMADO e não envia nada
//     hash antigo pendente?    → não faz nada, espera a próxima passagem
//     hash antigo inexistente? → aí sim, e só aí, assina de novo
//
// Somado ao delay de 1 h (`REENVIO_DELAY_MS`), que dá tempo de qualquer transação pendente
// resolver de um jeito ou de outro, é isto que torna o pagamento duplo improvável em vez de
// uma questão de tempo.
import { SAQUE, REENVIO_DELAY_MS, podeReenviar } from './game/orbs.mjs';
import * as odb from './orbs-db.mjs';

/** Quanto o laço espera entre duas varreduras. Saque não é operação de tempo real. */
export const INTERVALO_MS = 15_000;

/**
 * Processa UM saque: envia (ou reenvia, depois de reconferir) e registra o desfecho.
 *
 * @returns {'confirmado'|'enviado'|'falhou'|'adiado'|'ignorado'}
 */
export async function processarSaque(chain, saque, agora = Date.now()) {
  // ------------------------------------------------------ o caso do reenvio
  if (saque.status === SAQUE.FALHOU) {
    const r = podeReenviar(saque, agora);
    if (!r.ok) return 'adiado';

    // A RECONFERÊNCIA. Esta chamada é a que separa "reenviar" de "pagar duas vezes".
    if (saque.txHash) {
      const estado = await chain.estado(saque.txHash);
      if (estado === 'confirmada') {
        // Tinha dado certo o tempo todo. Não envia nada.
        await odb.marcarConfirmado(saque.id, saque.txHash);
        return 'confirmado';
      }
      if (estado === 'pendente') return 'adiado'; // ainda no ar: mexer agora é que seria erro
    }
  } else if (saque.status !== SAQUE.PENDENTE) {
    // ENVIANDO, CONFIRMADO ou CANCELADO não são deste worker. ENVIANDO em especial: aquela
    // transação pode estar no ar neste instante.
    return 'ignorado';
  }

  // -------------------------------------------------------------- o envio
  //
  // O hash é gravado ANTES do broadcast. Se o processo morrer no meio, o banco sabe qual
  // transação perguntar à rede na próxima passagem; gravar depois deixaria dinheiro saindo
  // sem registro de para onde.
  let txHash = null;
  try {
    const r = await chain.enviar({ para: saque.endereco, usdt: saque.usdt, id: saque.id });
    txHash = r.txHash;
    await odb.marcarEnviando(saque.id, txHash, agora);
  } catch (err) {
    // Mesmo na falha o hash pode existir (o broadcast chegou a montar a transação). Guardá-lo
    // é o que torna a reconferência possível daqui a uma hora — sem ele, a única saída seria
    // reenviar às cegas.
    if (err.txHash) await odb.marcarEnviando(saque.id, err.txHash, agora);
    await odb.marcarFalhou(saque.id, err.message, agora);
    return 'falhou';
  }

  // ------------------------------------------------------- a confirmação
  try {
    const estado = await chain.estado(txHash);
    if (estado === 'confirmada') {
      await odb.marcarConfirmado(saque.id, txHash);
      return 'confirmado';
    }
    // Pendente é normal: fica em ENVIANDO e `conferirEnviados` fecha depois.
    return 'enviado';
  } catch {
    // Não conseguir LER o estado não é motivo para marcar falha — a transação já foi
    // assinada e pode estar valendo. Fica em ENVIANDO e se resolve na próxima passagem.
    return 'enviado';
  }
}

/**
 * Fecha os saques que ficaram em ENVIANDO.
 *
 * Um `inexistente` aqui só vira falha depois da janela de reenvio: antes disso a transação
 * pode simplesmente ainda não ter se propagado para o nó que estamos consultando.
 */
export async function conferirEnviados(chain, saques, agora = Date.now()) {
  const out = { confirmados: 0, falhados: 0, pendentes: 0 };
  for (const s of saques) {
    if (s.status !== SAQUE.ENVIANDO || !s.txHash) continue;
    let estado;
    try {
      estado = await chain.estado(s.txHash);
    } catch {
      out.pendentes++;
      continue;
    }
    if (estado === 'confirmada') {
      await odb.marcarConfirmado(s.id, s.txHash);
      out.confirmados++;
    } else if (estado === 'falhou' || (estado === 'inexistente' && agora > s.tentadoEm + REENVIO_DELAY_MS)) {
      await odb.marcarFalhou(s.id, `transação ${estado}`, s.tentadoEm);
      out.falhados++;
    } else {
      out.pendentes++;
    }
  }
  return out;
}

/** Uma passagem completa: manda o que está na fila e fecha o que já saiu. */
export async function passagem(chain, agora = Date.now()) {
  const fila = await odb.saquesParaProcessar(agora, REENVIO_DELAY_MS);
  const r = { processados: 0, confirmados: 0, falhados: 0, adiados: 0, fechados: 0 };
  for (const s of fila) {
    const desfecho = await processarSaque(chain, s, agora);
    r.processados++;
    if (desfecho === 'confirmado') r.confirmados++;
    else if (desfecho === 'falhou') r.falhados++;
    else if (desfecho === 'adiado') r.adiados++;
  }
  const enviando = await odb.saquesEnviando();
  if (enviando.length) {
    const fechamento = await conferirEnviados(chain, enviando, agora);
    r.fechados = fechamento.confirmados + fechamento.falhados;
    r.confirmados += fechamento.confirmados;
    r.falhados += fechamento.falhados;
  }
  return r;
}

/**
 * Sobe o laço. Só um processo do cluster deve rodá-lo — dois workers assinando o mesmo saque
 * é o cenário de pagamento duplo mais fácil de causar. A trava é a mesma dos shards:
 * `posse:orbs-worker` no Redis.
 */
export function iniciarWorker(chain, { tomarPosse, intervaloMs = INTERVALO_MS } = {}) {
  let rodando = false;
  let liberar = null;

  const laco = async () => {
    if (rodando) return; // uma passagem por vez, sempre
    rodando = true;
    try {
      await passagem(chain);
    } catch (err) {
      console.error('[orbs] passagem do worker falhou:', err.message);
    } finally {
      rodando = false;
    }
  };

  return {
    async iniciar() {
      if (tomarPosse) {
        const posse = await tomarPosse();
        if (!posse.ok) {
          console.log('[orbs] worker de saque já tem dono neste cluster — este processo não vai enviar nada');
          return false;
        }
        liberar = posse.liberar;
      }
      console.log(
        `[orbs] worker de saque ativo (rede ${chain.id}${chain.simulada ? ', SIMULADA' : ''}, ` +
          `intervalo ${intervaloMs / 1000}s, reenvio após ${REENVIO_DELAY_MS / 60000} min)`,
      );
      this.timer = setInterval(laco, intervaloMs);
      return true;
    },
    async parar() {
      clearInterval(this.timer);
      await liberar?.();
    },
    passagem: laco,
  };
}
