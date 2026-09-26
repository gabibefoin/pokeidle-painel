// A ponte com a blockchain. É a ÚNICA parte do servidor que toca a rede e a chave.
//
// ### O contrato
//
// Uma rede precisa implementar quatro coisas:
//
//   `validarEndereco(end)`      → boolean
//   `enviar({ para, usdt, id })` → { txHash }          publica a transferência de USDT
//   `estado(txHash)`             → 'confirmada' | 'pendente' | 'inexistente' | 'falhou'
//   `recebidos({ desde })`       → [{ txHash, de, usdt, memo, confirmacoes }]
//
// `estado` é a mais importante das quatro, e é ela que impede pagar duas vezes: antes de
// reenviar qualquer saque, o worker pergunta o que aconteceu com o hash antigo.
//
// ### A chave privada
//
// Vem de `CARTEIRA_CHAVE_PRIVADA`, do ambiente, e **nunca** do repositório. O `.env` está no
// `.gitignore`. Em produção ela deveria estar num gerenciador de segredos (ou, melhor, atrás
// de um serviço de assinatura separado) — o processo do jogo não precisa da chave em memória
// para nada além de assinar saques, e é o processo mais exposto do sistema.
//
// ### O adaptador SIMULADO
//
// Sem `CHAIN_REDE` configurada, sobe `redeSimulada`: ela guarda "transações" em memória e
// permite forçar falhas. É com ela que `teste-orbs.mjs` exercita o caminho de reenvio sem
// gastar um centavo — testar contra a rede de verdade custaria dinheiro e seria lento demais
// para rodar a cada mudança.
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REDES } from './game/orbs.mjs';

const raizGame = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// --------------------------------------------------------------- simulada

/**
 * Rede de mentira, para desenvolvimento e teste.
 *
 * Reproduz os três desfechos que importam: sucesso, falha no broadcast e — o caso perigoso —
 * "o envio deu erro mas a transação CAIU do mesmo jeito". Esse último é o que justifica o
 * delay de 1 h e a reconferência: sem ele, um reenvio pagaria em dobro.
 */
export function redeSimulada(rede = 'solana') {
  const txs = new Map(); // hash → { estado, para, usdt }
  const cfg = REDES[rede];

  const ctrl = {
    /** Próximo `enviar` estoura. `caiuMesmoAssim` simula o pior caso. */
    proximoFalha: null, // null | { caiuMesmoAssim: boolean }
    recebidos: [],
  };

  return {
    id: rede,
    simulada: true,
    ctrl,

    validarEndereco: (end) => cfg.regex.test(String(end ?? '')),

    async enviar({ para, usdt }) {
      const hash = randomBytes(32).toString('hex');
      const falha = ctrl.proximoFalha;
      ctrl.proximoFalha = null;

      if (falha) {
        // O caso que assusta: o broadcast responde erro, mas a rede aceitou. É EXATAMENTE
        // isto que o reenvio ingênuo transformaria em pagamento duplo.
        if (falha.caiuMesmoAssim) txs.set(hash, { estado: 'confirmada', para, usdt });
        const err = new Error('falha simulada no broadcast');
        err.txHash = hash; // o hash existe mesmo com erro — é o que se vai reconferir depois
        throw err;
      }

      txs.set(hash, { estado: 'confirmada', para, usdt });
      return { txHash: hash };
    },

    async estado(txHash) {
      return txs.get(txHash)?.estado ?? 'inexistente';
    },

    /**
     * Com `endereco`, devolve só o que foi marcado para AQUELE endereço — é assim que o
     * teste exercita os endereços derivados, um por jogador, sem rede nenhuma.
     */
    async recebidos({ endereco = null } = {}) {
      if (!endereco) return ctrl.recebidos.splice(0);
      const meus = ctrl.recebidos.filter((d) => d.paraEndereco === endereco);
      ctrl.recebidos = ctrl.recebidos.filter((d) => d.paraEndereco !== endereco);
      return meus;
    },
  };
}

// ---------------------------------------------------------------- Solana

/**
 * Adaptador da Solana.
 *
 * ### Por que LER é `fetch` e só ESCREVER usa biblioteca
 *
 * `estado` e `recebidos` são JSON-RPC puro — `fetch` e mais nada. `enviar` é o único que
 * precisa montar e assinar uma transação, e para isso usa `@solana/web3.js` +
 * `@solana/spl-token`, importadas **preguiçosamente, dentro da função**.
 *
 * Isso não é estilo: `npm audit` acusa 8 vulnerabilidades na árvore dessas duas libs (uma
 * delas um estouro de buffer em `bigint-buffer`, severidade alta). Com o import lá dentro,
 * o gateway e o sim — que só leem, e são os processos expostos à internet — nunca chegam a
 * carregar esse código. Ele entra em memória apenas no processo com `ORBS_WORKER=1`, que é
 * o único que assina e o único que deveria ter a chave.
 *
 * Hand-rolling a serialização de transação evitaria as libs de vez, mas trocaria um risco
 * conhecido e auditado por código novo e sem auditoria nenhuma no caminho do dinheiro. Não
 * vale a troca.
 *
 * ### O detalhe que sustenta a proteção contra pagamento duplo
 *
 * A assinatura da transação na Solana é conhecida **assim que ela é assinada**, antes do
 * broadcast. `enviar` aproveita isso e anexa o hash a qualquer erro (`err.txHash`), que é
 * exatamente o que `processarSaque` precisa para reconferir daqui a uma hora em vez de
 * reenviar às cegas. Sem isso, um timeout de RPC viraria pagamento duplo.
 */
export function redeSolana({ rpcUrl, chavePrivada, contratoUsdt, carteiraProjeto }) {
  const cfg = REDES.solana;
  if (!rpcUrl) throw new Error('CHAIN_RPC_URL não configurada');
  if (!contratoUsdt) throw new Error('CHAIN_USDT_CONTRATO não configurado (o mint do USDT)');

  let seq = 0;
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  async function rpc(metodo, params, { tentativas = 5 } = {}) {
    for (let t = 0; t < tentativas; t++) {
      const r = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method: metodo, params }),
      });
      if (r.status === 429) {
        if (t + 1 >= tentativas) throw new Error(`RPC ${metodo} HTTP 429`);
        await dormir(150 * (t + 1));
        continue;
      }
      if (!r.ok) throw new Error(`RPC ${metodo} HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(`RPC ${metodo}: ${j.error.message}`);
      return j.result;
    }
  }

  /**
   * Casas decimais do mint, lidas do CONTRATO e nunca presumidas.
   *
   * USDT tem 6 na Solana, mas presumir isso é como o cabeçalho deste arquivo avisava para
   * não fazer: um mint com 9 casas transformaria um saque de 7 dólares em 7 mil. Lê uma vez
   * e guarda — o valor não muda depois que o mint existe.
   */
  let decimaisCache = null;
  async function decimais() {
    if (decimaisCache != null) return decimaisCache;
    const r = await rpc('getAccountInfo', [contratoUsdt, { encoding: 'jsonParsed' }]);
    const d = r?.value?.data?.parsed?.info?.decimals;
    if (!Number.isInteger(d)) throw new Error(`não consegui ler os decimais do mint ${contratoUsdt}`);
    decimaisCache = d;
    return d;
  }

  return {
    id: 'solana',
    simulada: false,
    rpcUrl,
    contratoUsdt,
    carteiraProjeto,

    validarEndereco: (end) => cfg.regex.test(String(end ?? '').trim()),

    /**
     * O que aconteceu com uma assinatura.
     *
     * `inexistente` e `falhou` são coisas MUITO diferentes para quem chama: a primeira
     * libera reenvio (depois da janela), a segunda não deveria — mas o `conferirEnviados`
     * trata as duas como fim de linha, e é ele quem decide. Aqui só se reporta.
     *
     * Cuidado com a janela de retenção: a Solana só guarda status recente em
     * `getSignatureStatuses` (~150 blocos). Por isso `searchTransactionHistory: true` —
     * sem ele, uma transação confirmada há uma hora voltaria como `inexistente` e o worker
     * a reenviaria. É a diferença entre reconferir e pagar duas vezes.
     */
    async estado(txHash) {
      const r = await rpc('getSignatureStatuses', [[txHash], { searchTransactionHistory: true }]);
      const s = r?.value?.[0];
      if (!s) return 'inexistente';
      if (s.err) return 'falhou';
      // `finalized` é o único estado do qual não se volta. `confirmed`/`processed` ainda
      // podem ser revertidos por um fork, e tratá-los como fechados marcaria um saque como
      // pago antes de ele ser irreversível.
      return s.confirmationStatus === 'finalized' ? 'confirmada' : 'pendente';
    },

    /**
     * Depósitos que chegaram na carteira do projeto.
     *
     * `desde` é a ÚLTIMA ASSINATURA já processada, não um carimbo de tempo: é o cursor que
     * a própria Solana entende (`until`), e usá-lo evita a janela de corrida que um
     * timestamp teria com transações do mesmo segundo.
     *
     * O `memo` é o que liga o dinheiro ao jogador — cada um tem um código de referência, e
     * é ele que a tela de depósito manda o jogador colar. Sem memo, o depósito chega mas
     * não há a quem creditar; o watcher registra e deixa para tratamento manual.
     */
    async recebidos({ desde = null, limite = 50, endereco = null } = {}) {
      // `endereco` permite varrer um endereço DERIVADO (um por jogador) em vez da carteira
      // do projeto. É o que substitui o memo: quem recebeu já diz de quem é o dinheiro.
      const alvo = endereco ?? carteiraProjeto;
      if (!alvo) throw new Error('CARTEIRA_PROJETO não configurada');
      const dec = await decimais();

      // Pergunta pelas CONTAS DE TOKEN do dono, não pelo endereço dele.
      //
      // Foi aqui que a primeira versão errou, e é um erro que só a rede de verdade mostra:
      // uma transferência SPL toca as contas de token (origem e destino) e o programa —
      // NÃO menciona o dono da conta de destino. `getSignaturesForAddress(dono)` devolvia
      // só a criação da conta (que menciona o dono) e perdia a transferência inteira.
      //
      // `getTokenAccountsByOwner` custa uma chamada a mais e resolve também o caso de o
      // jogador ter mais de uma conta daquele mint, que a derivação da ATA canônica não
      // cobriria.
      const contas = await rpc('getTokenAccountsByOwner', [alvo, { mint: contratoUsdt }, { encoding: 'jsonParsed' }]);
      const enderecosDeToken = (contas?.value ?? []).map((c) => c.pubkey);
      if (!enderecosDeToken.length) return []; // ninguém nunca mandou nada para cá

      const assinaturas = [];
      for (const conta of enderecosDeToken) {
        const sigs = await rpc('getSignaturesForAddress', [
          conta,
          { limit: Math.min(1000, limite), ...(desde ? { until: desde } : {}) },
        ]);
        assinaturas.push(...(sigs ?? []));
      }
      if (!assinaturas.length) return [];
      // Com mais de uma conta, as listas vêm intercaladas; reordena pelo tempo do bloco
      // para o cursor continuar significando "tudo antes disto já foi visto".
      assinaturas.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));

      const saida = [];
      // Da mais ANTIGA para a mais nova: `getSignaturesForAddress` devolve em ordem
      // decrescente, e quem chama vai guardar a última como cursor. Processar fora de ordem
      // deixaria o cursor à frente de transações ainda não vistas.
      for (const a of [...assinaturas].reverse()) {
        if (a.err) continue; // transação que falhou não moveu dinheiro nenhum

        const tx = await rpc('getTransaction', [
          a.signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'finalized' },
        ]);
        if (!tx?.meta || tx.meta.err) continue;

        // Quanto entrou de USDT na NOSSA conta: a diferença entre o saldo antes e depois.
        // Ler o valor da instrução seria mais direto, mas quebraria com transferências em
        // lote e com programas que empacotam várias — o saldo é o que de fato mudou.
        const nosso = (b) => b.owner === alvo && b.mint === contratoUsdt;
        const antes = (tx.meta.preTokenBalances ?? []).filter(nosso);
        const depois = (tx.meta.postTokenBalances ?? []).filter(nosso);
        const soma = (l) => l.reduce((s, b) => s + BigInt(b.uiTokenAmount?.amount ?? '0'), 0n);
        const delta = soma(depois) - soma(antes);
        if (delta <= 0n) continue; // saída nossa, ou transação que não nos moveu

        // O memo sai do RPC já decodificado (`program: 'spl-memo'`). Ler assim evita
        // fixar o id do programa de memo no código, que tem duas versões em circulação.
        const instrucoes = [
          ...(tx.transaction?.message?.instructions ?? []),
          ...(tx.meta.innerInstructions ?? []).flatMap((i) => i.instructions ?? []),
        ];
        const memo = instrucoes.find((i) => i.program === 'spl-memo')?.parsed ?? null;

        // Quem mandou: o dono da conta de token que perdeu saldo nesta transação.
        const perdeu = (tx.meta.preTokenBalances ?? []).find((b) => {
          if (b.mint !== contratoUsdt || b.owner === alvo) return false;
          const dp = (tx.meta.postTokenBalances ?? []).find((x) => x.accountIndex === b.accountIndex);
          return BigInt(dp?.uiTokenAmount?.amount ?? '0') < BigInt(b.uiTokenAmount?.amount ?? '0');
        });

        saida.push({
          txHash: a.signature,
          de: perdeu?.owner ?? null,
          usdt: Number(delta) / 10 ** dec,
          memo: typeof memo === 'string' ? memo.trim() : null,
          confirmacoes: a.confirmationStatus === 'finalized' ? 1 : 0,
          em: a.blockTime ? a.blockTime * 1000 : null,
        });
      }
      return saida;
    },

    /**
     * Assina e transmite uma transferência de USDT.
     *
     * A ordem importa e não é a óbvia: assina PRIMEIRO, extrai a assinatura, e só então
     * transmite. Com a assinatura em mãos antes do broadcast, qualquer erro de rede sobe
     * com `err.txHash` preenchido — e o worker consegue perguntar à blockchain o que
     * aconteceu em vez de reenviar no escuro.
     */
    /** Quanto de USDT há num endereço. Usado pela varredura para não montar transação à toa. */
    async saldoUsdt(endereco) {
      const r = await rpc('getTokenAccountsByOwner', [
        endereco,
        { mint: contratoUsdt },
        { encoding: 'jsonParsed' },
      ]);
      const soma = (r?.value ?? []).reduce(
        (s, c) => s + BigInt(c.account?.data?.parsed?.info?.tokenAmount?.amount ?? '0'),
        0n,
      );
      return Number(soma) / 10 ** (await decimais());
    },

    /** SOL nativo — a varredura paga taxas com a tesouraria. */
    async saldoSol(endereco) {
      const r = await rpc('getBalance', [endereco]);
      return (r?.value ?? 0) / 1e9;
    },

    /**
     * Recolhe o USDT de um endereço derivado para a tesouraria.
     *
     * O detalhe que faz isto funcionar: **a tesouraria paga a taxa**. O endereço derivado
     * assina a transferência do token, mas não precisa ter um centavo de SOL — o que
     * dispensa financiar milhares de endereços com SOL só para conseguir esvaziá-los
     * depois. São duas assinaturas na mesma transação: a do dono (autoriza o token) e a da
     * tesouraria (paga o gás).
     */
    async varrer({ semente, para }) {
      if (!chavePrivada) throw new Error('CARTEIRA_CHAVE_PRIVADA não configurada');
      const web3 = await import('@solana/web3.js');
      const spl = await import('@solana/spl-token');

      const conexao = new web3.Connection(rpcUrl, 'finalized');
      const tesouraria = web3.Keypair.fromSecretKey(lerChaveSolana(chavePrivada));
      const origem = web3.Keypair.fromSeed(Uint8Array.from(semente));
      const mint = new web3.PublicKey(contratoUsdt);
      const destino = new web3.PublicKey(para);
      const dec = await decimais();

      const destinoAta = await spl.getAssociatedTokenAddress(mint, destino);

      // O saldo pode estar em QUALQUER conta de token do dono — não só na ATA canônica.
      // `saldoUsdt` já soma todas; varrer só pela ATA deixava USDT preso e a varredura em 0.
      const contas = await rpc('getTokenAccountsByOwner', [
        origem.publicKey.toBase58(),
        { mint: contratoUsdt },
        { encoding: 'jsonParsed' },
      ]);
      const comSaldo = (contas?.value ?? []).filter(
        (c) => BigInt(c.account?.data?.parsed?.info?.tokenAmount?.amount ?? '0') > 0n,
      );
      if (!comSaldo.length) return { txHash: null, usdt: 0 };

      const tx = new web3.Transaction();
      tx.add(
        spl.createAssociatedTokenAccountIdempotentInstruction(tesouraria.publicKey, destinoAta, destino, mint),
      );

      let totalBruto = 0n;
      for (const c of comSaldo) {
        const bruto = BigInt(c.account.data.parsed.info.tokenAmount.amount);
        const origemAta = new web3.PublicKey(c.pubkey);
        tx.add(
          spl.createTransferCheckedInstruction(origemAta, mint, destinoAta, origem.publicKey, bruto, dec),
        );
        totalBruto += bruto;
      }

      const { blockhash } = await conexao.getLatestBlockhash('finalized');
      tx.recentBlockhash = blockhash;
      tx.feePayer = tesouraria.publicKey; // <- a tesouraria banca o gás
      tx.sign(tesouraria, origem);

      const txHash = base58Encode(tx.signature);
      try {
        const enviada = await conexao.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
        return { txHash: enviada, usdt: Number(totalBruto) / 10 ** dec };
      } catch (err) {
        if (txHash) err.txHash = txHash;
        throw err;
      }
    },

    async enviar({ para, usdt, id }) {
      if (!chavePrivada) throw new Error('CARTEIRA_CHAVE_PRIVADA não configurada');
      if (!this.validarEndereco(para)) throw new Error(`endereço inválido: ${para}`);

      // Import preguiçoso: ver a nota no topo desta função sobre a árvore de dependências.
      const web3 = await import('@solana/web3.js');
      const spl = await import('@solana/spl-token');

      const conexao = new web3.Connection(rpcUrl, 'finalized');
      const dono = web3.Keypair.fromSecretKey(lerChaveSolana(chavePrivada));
      const mint = new web3.PublicKey(contratoUsdt);
      const destino = new web3.PublicKey(para);
      const dec = await decimais();

      const bruto = BigInt(Math.round(usdt * 10 ** dec));
      if (bruto <= 0n) throw new Error('valor de saque inválido');

      const origemAta = await spl.getAssociatedTokenAddress(mint, dono.publicKey);
      const destinoAta = await spl.getAssociatedTokenAddress(mint, destino);

      const tx = new web3.Transaction();
      // `Idempotent`: se a conta de token do destinatário já existe, a instrução vira no-op
      // em vez de derrubar a transação inteira. A versão não-idempotente falha, e aí um
      // saque para quem já recebeu antes nunca sairia.
      tx.add(
        spl.createAssociatedTokenAccountIdempotentInstruction(dono.publicKey, destinoAta, destino, mint),
        spl.createTransferCheckedInstruction(origemAta, mint, destinoAta, dono.publicKey, bruto, dec),
      );
      // O id do saque vai no memo: é o que permite casar a transação on-chain com a linha
      // do banco numa auditoria, sem depender de a nossa tabela estar certa.
      if (id) tx.add(memoInstrucao(web3, String(id)));

      const { blockhash, lastValidBlockHeight } = await conexao.getLatestBlockhash('finalized');
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = dono.publicKey;
      tx.sign(dono);

      // A assinatura JÁ EXISTE aqui, antes de qualquer byte sair da máquina. É o que
      // permite anexá-la ao erro lá embaixo.
      const txHash = base58Encode(tx.signature);

      try {
        const enviada = await conexao.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        return { txHash: enviada };
      } catch (err) {
        // O hash existe mesmo com o broadcast falhando — a transação foi assinada. É ele
        // que torna a reconferência possível, em vez de um reenvio às cegas.
        if (txHash) err.txHash = txHash;
        throw err;
      }
    },
  };
}

/**
 * O programa de Memo da Solana (SPL Memo v2).
 *
 * Aqui o id VAI fixo — para escrever não há como evitá-lo, ao contrário da leitura, em que
 * o RPC devolve o programa já identificado por nome. Se este id estiver errado, a
 * transação inteira é rejeitada pela rede, então o primeiro saque na devnet prova ou
 * derruba esta constante. Confira no explorer antes de ligar a mainnet.
 */
const PROGRAMA_MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

function memoInstrucao(web3, texto) {
  return new web3.TransactionInstruction({
    keys: [],
    programId: new web3.PublicKey(PROGRAMA_MEMO),
    data: Buffer.from(texto, 'utf8'),
  });
}

const ALFABETO_58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 da Solana. Vinte linhas em vez de mais uma dependência no caminho do dinheiro. */
export function base58Encode(bytes) {
  const b = Uint8Array.from(bytes);
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let s = '';
  while (n > 0n) {
    s = ALFABETO_58[Number(n % 58n)] + s;
    n /= 58n;
  }
  // Cada zero à esquerda vira um '1' — sem isto, endereços que começam com zero perdem
  // caracteres e deixam de casar com o que a rede conhece.
  for (const x of b) { if (x === 0) s = '1' + s; else break; }
  return s;
}

/**
 * Aceita a chave nos dois formatos que a CLI da Solana produz.
 *
 * `solana-keygen new --outfile` grava um ARRAY JSON de 64 bytes; carteiras de navegador
 * exportam base58. Aceitar os dois evita o erro mais fácil de cometer aqui, que é colar o
 * formato errado no `.env` e descobrir só na hora do primeiro saque.
 */
export function lerChaveSolana(valor) {
  let bruto = String(valor).trim();

  // Se apontar para um ARQUIVO, lê de lá. É o formato que o `solana-keygen --outfile` e o
  // `gerar-carteira.mjs` gravam, e evita copiar a chave para dentro do .env — cada cópia
  // de um segredo é mais uma chance de ele acabar num lugar errado.
  if (!bruto.startsWith('[') && (bruto.endsWith('.json') || bruto.includes('/') || bruto.includes('\\'))) {
    let caminho = resolve(bruto);
    if (!existsSync(caminho)) caminho = resolve(raizGame, bruto);
    bruto = readFileSync(caminho, 'utf8').trim();
  }
  if (bruto.startsWith('[')) {
    const arr = JSON.parse(bruto);
    if (!Array.isArray(arr) || arr.length !== 64) throw new Error('chave JSON precisa ter 64 bytes');
    return Uint8Array.from(arr);
  }
  // base58 sem depender de lib: o alfabeto da Solana, decodificado à mão.
  const ALFA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const ch of bruto) {
    const i = ALFA.indexOf(ch);
    if (i < 0) throw new Error('CARTEIRA_CHAVE_PRIVADA não é base58 nem array JSON');
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of bruto) { if (ch === '1') bytes.unshift(0); else break; }
  if (bytes.length !== 64) throw new Error(`chave base58 deu ${bytes.length} bytes, esperava 64`);
  return Uint8Array.from(bytes);
}

/** Monta o adaptador conforme o ambiente. Sem `CHAIN_REDE`, cai na simulada. */
export function criarChain(env = process.env) {
  const rede = env.CHAIN_REDE;
  if (!rede) return redeSimulada(env.CHAIN_REDE_SIMULADA ?? 'solana');
  if (rede === 'solana') {
    return redeSolana({
      rpcUrl: env.CHAIN_RPC_URL,
      chavePrivada: env.CARTEIRA_CHAVE_PRIVADA,
      contratoUsdt: env.CHAIN_USDT_CONTRATO,
      carteiraProjeto: env.CARTEIRA_PROJETO,
    });
  }
  throw new Error(
    `adaptador de ${rede} não implementado — só 'solana' existe hoje. ` +
      `Rode com CHAIN_REDE vazio para usar a rede simulada.`,
  );
}
