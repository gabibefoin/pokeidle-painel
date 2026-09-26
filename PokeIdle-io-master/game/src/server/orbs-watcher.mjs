// O watcher de DEPÓSITOS: a ponte que traz dinheiro para dentro.
//
// É o espelho do `orbs-worker.mjs`, que leva dinheiro para fora, e os dois riscos são
// opostos. Lá o perigo é pagar duas vezes; aqui é CREDITAR duas vezes — o mesmo depósito
// contado em duas passagens vira ORB sem lastro, que é exatamente o que quebra a conta do
// caixa (ver a regra de emissão em `game/orbs.mjs`).
//
// ### Por que creditar duas vezes é fácil de acontecer
//
// A varredura é um laço que pergunta à blockchain "o que chegou desde X?". Qualquer coisa
// que faça o cursor voltar atrás — restart do processo, reorg, dois watchers no ar — faz a
// mesma transação aparecer de novo. E ela É a mesma: mesmo hash, mesmo valor, mesmo memo.
//
// A defesa não está aqui, está no banco: `orb_depositos` tem `UNIQUE (rede, tx_hash)`, e
// `creditarDeposito` insere com `ON CONFLICT DO NOTHING` dentro da transação que credita.
// Na segunda vez o INSERT não acontece, o crédito é pulado, e este arquivo nem fica sabendo.
// Ou seja: **este watcher pode reprocessar o mesmo bloco à vontade**, de propósito.
//
// Por isso o cursor aqui é uma otimização (não varrer o histórico inteiro toda vez), e não
// um mecanismo de correção. Se ele se perder, o pior que acontece é trabalho repetido.
//
// ### O memo é quem diz de quem é o dinheiro
//
// O modelo é custodial e há UMA carteira para todo mundo, então a transferência sozinha não
// diz nada — só que alguém mandou USDT. Quem liga o valor a uma conta é o código de
// referência que o jogador cola no memo (`orb_referencias`).
//
// Depósito sem memo, ou com memo que não bate com ninguém, NÃO é descartado: vira uma linha
// em `orb_orfaos` para tratamento manual. Jogar fora seria ficar com o dinheiro de alguém.
import { pool } from './db.mjs';
import * as odb from './orbs-db.mjs';
import * as adb from './afiliados-db.mjs';
import * as enderecos from './orbs-enderecos.mjs';
import { usdtParaOrbs } from './game/orbs.mjs';

/** Intervalo entre varreduras. Depósito não é tempo real — o jogador espera a confirmação. */
export const INTERVALO_MS = 30_000;

/**
 * Confirmações exigidas antes de creditar.
 *
 * Na Solana o adaptador só reporta `confirmacoes: 1` quando a transação está `finalized`,
 * que é o estado do qual não se volta. Exigir 1 aqui significa, na prática, "espere
 * finalizar" — e é o que impede creditar algo que um fork ainda pode desfazer.
 */
export const CONFIRMACOES_MINIMAS = 1;

export async function migrar() {
  // O cursor da varredura. Uma linha por rede.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orb_watcher (
      rede           TEXT PRIMARY KEY,
      ultima_assinatura TEXT,
      visto_em       TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  // Dinheiro que chegou e não se sabe de quem é. Nunca some sozinho: alguém resolve à mão.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orb_orfaos (
      id          BIGSERIAL PRIMARY KEY,
      rede        TEXT NOT NULL,
      tx_hash     TEXT NOT NULL,
      de_endereco TEXT,
      usdt        NUMERIC(20,6) NOT NULL,
      memo        TEXT,
      motivo      TEXT NOT NULL,          -- 'sem_memo' | 'memo_desconhecido'
      resolvido_em TIMESTAMPTZ,
      nota        TEXT,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (rede, tx_hash)
    )`);
}

const cursorDe = async (rede) => {
  const { rows } = await pool.query(`SELECT ultima_assinatura FROM orb_watcher WHERE rede = $1`, [rede]);
  return rows[0]?.ultima_assinatura ?? null;
};

const gravarCursor = (rede, assinatura) =>
  pool.query(
    `INSERT INTO orb_watcher (rede, ultima_assinatura, visto_em) VALUES ($1,$2,now())
     ON CONFLICT (rede) DO UPDATE SET ultima_assinatura = $2, visto_em = now()`,
    [rede, assinatura],
  );

/** Guarda o que chegou sem dono. `ON CONFLICT` porque a varredura pode repassar o mesmo. */
const registrarOrfao = (rede, d, motivo) =>
  pool.query(
    `INSERT INTO orb_orfaos (rede, tx_hash, de_endereco, usdt, memo, motivo)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (rede, tx_hash) DO NOTHING`,
    [rede, d.txHash, d.de ?? null, d.usdt, d.memo ?? null, motivo],
  );

/**
 * Credita UM depósito já identificado. Devolve o que aconteceu, para o resumo.
 *
 * A idempotência não está aqui: está no `ON CONFLICT (rede, tx_hash)` de
 * `creditarDeposito`. Chamar isto duas vezes com o mesmo hash é seguro por construção.
 */
async function creditar(rede, d, playerId, referencia) {
  const orbs = usdtParaOrbs(d.usdt);
  if (orbs <= 0) {
    // Poeira: menos de uma ORB. Vira órfão em vez de sumir — é dinheiro de alguém.
    await registrarOrfao(rede, d, 'valor_menor_que_uma_orb');
    return 'orfao';
  }
  const res = await odb.creditarDeposito({
    playerId, rede, txHash: d.txHash, deEndereco: d.de, usdt: d.usdt, orbs, referencia,
  });
  if (res.creditado) {
    adb.comissaoOrb(playerId, orbs, `${rede}:${d.txHash}`)
      .catch((err) => console.error('[afiliados] comissão gema:', err.message));
  }
  return res.creditado ? { tipo: 'creditado', orbs } : 'repetido';
}

/**
 * Passagem com ENDEREÇO POR JOGADOR — o modo bom.
 *
 * Não há memo para interpretar: o endereço que recebeu já diz de quem é. Varre só os
 * endereços armados (ver a nota sobre a janela em `orbs-enderecos.mjs`), com um cursor
 * próprio para cada um, e um erro num endereço não impede os outros de serem processados.
 */
export async function passagemDerivada(chain, { limite = 25 } = {}) {
  const rede = chain.id;
  const r = { vistos: 0, creditados: 0, orfaos: 0, repetidos: 0, imaturos: 0, orbs: 0, enderecos: 0 };

  const lista = await enderecos.armados();
  r.enderecos = lista.length;

  for (const alvo of lista) {
    try {
      const chegaram = await chain.recebidos({ endereco: alvo.endereco, desde: alvo.cursor, limite });
      r.vistos += chegaram.length;
      let ultima = null;

      for (const d of chegaram) {
        if ((d.confirmacoes ?? 0) < CONFIRMACOES_MINIMAS) {
          // Não finalizada: para AQUI e não avança o cursor, senão ela seria esquecida.
          r.imaturos++;
          break;
        }
        const saida = await creditar(rede, d, alvo.playerId, alvo.endereco);
        if (saida === 'orfao') r.orfaos++;
        else if (saida === 'repetido') r.repetidos++;
        else { r.creditados++; r.orbs += saida.orbs; }
        ultima = d.txHash;
      }
      if (ultima) await enderecos.gravarCursor(alvo.endereco, ultima);
    } catch (err) {
      // O endereço de um jogador com problema não pode travar a fila dos outros.
      console.error(`[orbs] endereço ${alvo.endereco} falhou: ${err.message}`);
    }
  }
  return r;
}

/**
 * Uma passagem: lê o que chegou, credita quem dá para identificar, arquiva o resto.
 *
 * Este é o modo ANTIGO, com uma carteira só e o jogador colando um código no memo. Fica
 * como caminho de compatibilidade: sem `ORB_SEED_DEPOSITOS` configurada, é o que roda.
 *
 * Devolve o resumo para quem quiser logar ou testar. Não lança em erro de um depósito
 * individual — um memo estranho não pode interromper a fila e travar os depósitos de todo
 * mundo atrás dele.
 */
export async function passagem(chain, { limite = 50 } = {}) {
  const rede = chain.id;
  const desde = await cursorDe(rede);
  const chegaram = await chain.recebidos({ desde, limite });

  const r = { vistos: chegaram.length, creditados: 0, orfaos: 0, repetidos: 0, imaturos: 0, orbs: 0 };
  let ultima = null;

  for (const d of chegaram) {
    try {
      // Ainda não finalizada: NÃO avança o cursor. Deixá-la para trás significaria
      // esquecê-la para sempre; parar aqui faz a próxima passagem reencontrá-la.
      if ((d.confirmacoes ?? 0) < CONFIRMACOES_MINIMAS) {
        r.imaturos++;
        break;
      }

      const memo = (d.memo ?? '').trim().toUpperCase();
      const playerId = memo ? await odb.jogadorPorReferencia(memo) : null;

      if (!playerId) {
        await registrarOrfao(rede, d, memo ? 'memo_desconhecido' : 'sem_memo');
        r.orfaos++;
        ultima = d.txHash;
        continue;
      }

      const orbs = usdtParaOrbs(d.usdt);
      if (orbs <= 0) {
        // Poeira: menos de uma ORB. Vira órfão em vez de sumir — é dinheiro de alguém.
        await registrarOrfao(rede, d, 'valor_menor_que_uma_orb');
        r.orfaos++;
        ultima = d.txHash;
        continue;
      }

      // O `ON CONFLICT` de `creditarDeposito` é o que torna isto idempotente. Ver o topo.
      const res = await odb.creditarDeposito({
        playerId,
        rede,
        txHash: d.txHash,
        deEndereco: d.de,
        usdt: d.usdt,
        orbs,
        referencia: memo,
      });
      if (res.creditado) {
        r.creditados++;
        r.orbs += orbs;
        adb.comissaoOrb(playerId, orbs, `${rede}:${d.txHash}`)
          .catch((err) => console.error('[afiliados] comissão gema:', err.message));
      } else {
        r.repetidos++;
      }
      ultima = d.txHash;
    } catch (err) {
      // Um depósito problemático não pode travar a fila. Para o cursor aqui: a próxima
      // passagem tenta de novo a partir dele, e o log diz qual foi.
      console.error(`[orbs] depósito ${d.txHash} falhou: ${err.message}`);
      break;
    }
  }

  if (ultima) await gravarCursor(rede, ultima);
  return r;
}

/**
 * Sobe o laço.
 *
 * Ao contrário do worker de saque, dois watchers no ar não causam prejuízo — o `UNIQUE` do
 * banco absorve a duplicidade. Ainda assim a posse existe: dois processos varrendo a mesma
 * coisa é o dobro de chamadas de RPC por nada, e provedores cobram por isso.
 */
export function iniciarWatcher(chain, { tomarPosse, intervaloMs = INTERVALO_MS } = {}) {
  let rodando = false;
  let liberar = null;

  // Com seed configurada, cada jogador tem endereço próprio e não existe memo para errar.
  // Sem ela, cai no modo antigo (uma carteira + memo). A escolha é feita uma vez, na
  // subida: trocar de modo com o jogo no ar deixaria depósitos no meio do caminho.
  const derivado = enderecos.temSeed();

  const laco = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = derivado ? await passagemDerivada(chain) : await passagem(chain);
      if (r.creditados || r.orfaos) {
        console.log(
          `[orbs] watcher: ${r.creditados} creditado(s) (${r.orbs} ORBs)` +
            `${r.orfaos ? `, ${r.orfaos} órfão(s)` : ''}${r.repetidos ? `, ${r.repetidos} repetido(s)` : ''}`,
        );
      }
    } catch (err) {
      console.error('[orbs] varredura de depósitos falhou:', err.message);
    } finally {
      rodando = false;
    }
  };

  return {
    async iniciar() {
      if (chain.simulada) {
        console.log('[orbs] watcher de depósitos NÃO subiu — rede simulada não recebe nada de fora');
        return false;
      }
      if (tomarPosse) {
        const posse = await tomarPosse();
        if (!posse.ok) {
          console.log('[orbs] watcher de depósitos já tem dono neste cluster');
          return false;
        }
        liberar = posse.liberar;
      }
      await migrar();
      await enderecos.migrar();
      console.log(
        `[orbs] watcher de depósitos ativo (rede ${chain.id}, a cada ${intervaloMs / 1000}s, ` +
          `${derivado ? 'ENDEREÇO POR JOGADOR' : 'carteira única + memo'})`,
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
