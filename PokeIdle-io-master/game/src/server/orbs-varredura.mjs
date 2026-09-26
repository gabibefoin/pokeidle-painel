// A varredura: junta na tesouraria o USDT parado nos endereços dos jogadores.
//
// Com um endereço por jogador (ver `orbs-enderecos.mjs`), o dinheiro chega espalhado. Isso
// resolve a identificação, mas cria um problema novo: pagar um saque exige saldo num lugar
// só. Esta é a peça que fecha o ciclo.
//
// ### Não é urgente, e é de propósito
//
// O crédito de ORB acontece no DEPÓSITO, não aqui — o jogador já está jogando com o saldo
// dele muito antes de a varredura rodar. Ela é operacional: existe para a tesouraria ter
// caixa quando alguém sacar. Por isso o intervalo é de horas, não de segundos, e uma
// passagem que falha inteira não afeta jogador nenhum.
//
// ### A tesouraria paga o gás
//
// Endereço derivado não tem SOL, e financiar milhares deles seria absurdo. A transação de
// varredura leva DUAS assinaturas: o endereço derivado autoriza a saída do token, e a
// tesouraria banca a taxa como `feePayer`. Detalhe em `chain.varrer`.
//
// ### O que ainda não foi provado
//
// Todo o resto do sistema de ORBs tem teste contra a rede simulada. Esta parte NÃO — ela
// depende de assinar com duas chaves e de a rede aceitar, e simular isso testaria o
// simulador. Rode na devnet antes de confiar (`node tools/varrer.mjs --dry`).
import * as enderecos from './orbs-enderecos.mjs';
import { sementeDoJogador, lerSeedMestra } from './derivacao.mjs';

/** De quanto em quanto tempo. Um dia — ver a nota sobre urgência no topo. */
export const INTERVALO_MS = 24 * 3600_000;

/**
 * Piso do cron diário — abaixo disto não vale o gás da rede.
 * Cada varredura custa taxa e, na primeira vez, aluguel da conta de token.
 */
export const MINIMO_USDT = 1;

/** Piso da varredura manual no admin — mesmo piso do cron (override: ORBS_VARREDURA_MINIMO_ADMIN). */
export const MINIMO_USDT_ADMIN = Number(process.env.ORBS_VARREDURA_MINIMO_ADMIN) || MINIMO_USDT;

/** Pausa entre endereços. 120 ms ≈ 8 req/s — margem no limite de 10/s do RPC gratuito. */
export const PAUSA_RPC_MS = Number(process.env.ORBS_VARREDURA_PAUSA_MS) || 120;

/** Início do dia UTC — use com `--hoje` para restringir ao cron leve. */
export function inicioDoDiaUtc(agora = Date.now()) {
  const d = new Date(agora);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Uma passagem. Devolve o resumo.
 *
 * `dry` monta e mede tudo mas não assina nada — é como conferir na devnet o que ela FARIA
 * antes de deixá-la fazer.
 *
 * Por padrão olha quem tem depósito > 0 no ledger (não todo endereço já criado).
 * `desde` restringe por data; `--hoje` no CLI passa `inicioDoDiaUtc()`.
 */
export async function passagem(
  chain,
  { minimo = MINIMO_USDT, dry = false, limite = 500, desde = null, pausaMs = PAUSA_RPC_MS } = {},
) {
  if (chain.simulada) return { pulado: 'rede simulada', recolhidos: 0, usdt: 0 };
  if (!chain.carteiraProjeto) throw new Error('CARTEIRA_PROJETO não configurada');

  const seed = lerSeedMestra(process.env.ORB_SEED_DEPOSITOS);
  const lista = await enderecos.comDepositoNoLedger({ limite, desde });
  const r = { olhados: 0, recolhidos: 0, usdt: 0, pulados: 0, falhas: 0, dry, candidatos: lista.length, desde };

  for (let i = 0; i < lista.length; i++) {
    const e = lista[i];
    if (i > 0 && pausaMs > 0) await dormir(pausaMs);
    try {
      r.olhados++;
      const saldo = await chain.saldoUsdt(e.endereco);
      if (saldo < minimo) {
        r.pulados++;
        continue;
      }
      if (dry) {
        r.recolhidos++;
        r.usdt += saldo;
        console.log(`  [dry] recolheria ${saldo} USDT de ${e.endereco} (jogador ${e.playerId})`);
        continue;
      }
      const saida = await chain.varrer({
        semente: sementeDoJogador(seed, e.indice),
        para: chain.carteiraProjeto,
      });
      if (saida.txHash) {
        r.recolhidos++;
        r.usdt += saida.usdt;
      } else if (saldo >= minimo) {
        // `saldoUsdt` viu dinheiro mas a transferência não saiu — não deixa passar em silêncio.
        r.falhas++;
        console.error(`[orbs] varredura de ${e.endereco}: saldo ${saldo} USDT mas transferência vazia`);
      }
    } catch (err) {
      // Um endereço problemático não pode travar a fila. O dinheiro não some — fica lá
      // para a próxima passagem.
      r.falhas++;
      console.error(`[orbs] varredura de ${e.endereco} falhou: ${err.message}`);
    }
  }
  return r;
}

/** Sobe o laço. Mesma trava de posse do worker — duas varreduras concorrentes só gastam gás. */
export function iniciarVarredura(chain, { tomarPosse, intervaloMs = INTERVALO_MS } = {}) {
  let rodando = false;
  let liberar = null;

  const laco = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await passagem(chain);
      if (r.recolhidos) console.log(`[orbs] varredura: ${r.recolhidos} endereço(s), ${r.usdt} USDT para a tesouraria`);
    } catch (err) {
      console.error('[orbs] varredura falhou:', err.message);
    } finally {
      rodando = false;
    }
  };

  return {
    async iniciar() {
      if (chain.simulada || !enderecos.temSeed()) {
        console.log('[orbs] varredura NÃO subiu — precisa de rede real e ORB_SEED_DEPOSITOS');
        return false;
      }
      if (tomarPosse) {
        const posse = await tomarPosse();
        if (!posse.ok) return false;
        liberar = posse.liberar;
      }
      console.log(`[orbs] varredura ativa (a cada ${intervaloMs / 3600000}h, piso de ${MINIMO_USDT} USDT)`);
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
