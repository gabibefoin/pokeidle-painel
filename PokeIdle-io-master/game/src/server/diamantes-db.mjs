// Persistência dos DIAMANTES: o ledger e a caixa postal dos pagamentos.
//
// ### O ledger é a verdade, `players.diamonds` é cache
//
// Mesmo desenho de `orbs-db.mjs`, pelas mesmas três razões (auditoria, reconstrução, detecção
// de bug) e por uma quarta que só existe aqui: **o crédito não chega pelo dono do jogador.**
//
// ### O problema do webhook, e a caixa postal
//
// O jogo é shardado por jogador: quem pode mexer no estado de alguém é o sim dono daquele
// shard, e é a memória dele que o `flushJogadores` grava a cada 5 s. O webhook de pagamento,
// porém, bate num GATEWAY — um processo que não tem aquela memória e nem sabe qual sim tem.
//
// Isso descarta as duas saídas óbvias:
//
//   · somar em memória — o gateway não tem a memória do jogador;
//   · somar direto no banco — funcionaria, não fosse o `flushJogadores`, que grava `diamonds`
//     a partir da memória do sim e passaria por cima do crédito no ciclo seguinte.
//
// A saída é a mesma que o Mercado da Comunidade já usa para pagar vendedores offline: o
// gateway credita no LEDGER (que é a verdade e não passa pelo flush) e deixa a linha marcada
// como não entregue. O sim recolhe — no login e numa varredura por minuto — e aí só atualiza o
// cache da tela. Por isso `diamonds` SAIU do `flushJogadores`: as duas escritas na mesma coluna
// eram exatamente o conflito descrito acima.
//
// ### Idempotência
//
// A referência do pagamento é `UNIQUE`, e o crédito só acontece na transição
// `pendente → pago`, feita com `WHERE status = 'pendente'`. Webhook repetido (o provedor
// reenvia até receber 200), webhook + reconciliação chegando juntos, dois gateways processando
// o mesmo evento: em todos os casos só o primeiro `UPDATE` encontra a linha pendente, e os
// outros veem `rowCount = 0` e não creditam nada.
import { pool } from './db.mjs';
import { cifrar, decifrar } from './cofre.mjs';
import { MOTIVO, MOTIVOS_QUE_ENCHEM_A_COTA, PAGAMENTO, precoEmCentavos } from './game/diamantes.mjs';

export async function migrar() {
  // A coluna já existia (a Loja nasceu cobrando em diamante antes de passar por ORB); o
  // `IF NOT EXISTS` é só para bancos criados fora do `schema.sql`.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS diamonds BIGINT NOT NULL DEFAULT 0`);

  // Toda movimentação de diamante, uma linha. Append-only: nada de UPDATE nem DELETE aqui.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS diamante_ledger (
      id          BIGSERIAL PRIMARY KEY,
      player_id   BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      delta       BIGINT NOT NULL,          -- + entrou, − saiu (nunca 0)
      saldo_apos  BIGINT NOT NULL,
      motivo      TEXT   NOT NULL,
      ref         TEXT,                     -- referência do pagamento, id do produto…
      nota        TEXT,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dia_ledger_player ON diamante_ledger(player_id, id DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dia_ledger_motivo ON diamante_ledger(motivo)`);

  // Os pagamentos. `referencia` é a nossa chave (vai para o provedor e volta no webhook);
  // `provedor_ref` é a chave DELES, guardada para a reconciliação conseguir consultar.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS diamante_pagamentos (
      referencia    TEXT PRIMARY KEY,
      player_id     BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      nick          TEXT   NOT NULL,
      qtd           BIGINT NOT NULL,
      centavos      BIGINT NOT NULL,
      metodo        TEXT   NOT NULL,        -- pix | cartao
      provedor      TEXT   NOT NULL,        -- efi | stripe (linha antiga pode trazer "livepix")
      provedor_ref  TEXT,                   -- id da sessão/cobrança do provedor
      status        TEXT   NOT NULL,
      comprovante   TEXT,
      -- Quando o jogador marcou o aceite dos termos da compra. Fica na MESMA linha do
      -- pagamento porque é dela que a resposta a um estorno sai: valor, método e o instante
      -- em que o texto foi aceito, tudo junto.
      aceite_em     TIMESTAMPTZ,
      -- A caixa postal: false enquanto o sim dono do jogador não recolheu o crédito.
      entregue      BOOLEAN NOT NULL DEFAULT false,
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
      pago_em       TIMESTAMPTZ
    )`);
  // Banco que já existia antes do aceite: a coluna entra sem tocar nas linhas antigas.
  await pool.query(`ALTER TABLE diamante_pagamentos ADD COLUMN IF NOT EXISTS aceite_em TIMESTAMPTZ`);

  // Dados do TOMADOR para a nota fiscal de serviço de cada compra. O CPF é digitado pelo jogador
  // no checkout; o nome vem do provedor (Stripe `customer_details.name` / Efí
  // `gnExtras.pagador.nome`) e é preenchido no crédito; o e-mail vem da conta. Colunas anuláveis
  // porque (a) as linhas antigas não têm, (b) o nome só chega depois do pagamento. O painel de
  // admin (aba "Emissão de Notas") exporta esses campos por mês para lançar na contabilidade.
  await pool.query(`ALTER TABLE diamante_pagamentos ADD COLUMN IF NOT EXISTS tomador_cpf   TEXT`);
  await pool.query(`ALTER TABLE diamante_pagamentos ADD COLUMN IF NOT EXISTS tomador_nome  TEXT`);
  await pool.query(`ALTER TABLE diamante_pagamentos ADD COLUMN IF NOT EXISTS tomador_email TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dia_pag_player ON diamante_pagamentos(player_id, criado_em DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dia_pag_status ON diamante_pagamentos(status)`);
  // O índice da caixa postal: parcial, porque a varredura só pergunta pelos não entregues e
  // essa é a minoria eterna da tabela (todo pagamento vira entregue e nunca mais volta).
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dia_pag_caixa ON diamante_pagamentos(player_id)
     WHERE status = 'pago' AND entregue = false`);

  await ressarcirPesca();
}

/** O `ref` das linhas do ressarcimento — carimbo de qual rodada pagou, para a auditoria. */
const REF_RESSARCIMENTO_PESCA = 'pesca_v1';

/**
 * O RESSARCIMENTO DA PESCA — pago uma vez, no boot em que o modo saiu do jogo.
 *
 * A Pesca era uma segunda barra de progressão, e havia gente com centenas de níveis nela. Tirar
 * o modo sem devolver nada apagaria esse tempo, então cada NÍVEL de pesca vira **1 diamante**.
 * `fishing_skill` é o número gravado no banco (nunca foi derivado do total de peixes), então
 * ele continua sendo a medida exata do que cada um investiu — e é por isso que a coluna NÃO
 * foi dropada junto com o modo: ela é o comprovante deste pagamento.
 *
 * ### Por que aqui, e não num script solto
 *
 * Roda dentro do `migrar()` deste módulo, logo depois das tabelas do ledger nascerem: no boot
 * o crédito não disputa com ninguém, e a tabela que ele precisa acabou de ser criada. Um script
 * manual dependeria de alguém lembrar de rodá-lo em cada ambiente.
 *
 * ### Idempotência — a mesma régua do webhook
 *
 * Duas travas, e as duas precisam existir:
 *
 *   · o `NOT EXISTS` no ledger — quem já tem a linha do ressarcimento não entra na conta, então
 *     reiniciar o gateway cem vezes não paga cem vezes;
 *   · o índice PARCIAL ÚNICO por jogador — é o que fecha a janela em que dois gateways sobindo
 *     ao mesmo tempo leem o `NOT EXISTS` antes de qualquer um dos dois gravar. O `INSERT` do
 *     segundo estoura, e como UPDATE e INSERT moram na MESMA instrução, o crédito dele volta
 *     atrás inteiro. O `advisory lock` logo acima evita que isso chegue a acontecer; o índice
 *     é o que garante que, se acontecer, ninguém recebe em dobro.
 *
 * `players.diamonds` pode ser escrito aqui direto porque ele saiu do `flushJogadores` (ver o
 * comentário de lá): o ledger é a verdade e o sim só mantém cache de tela. Quem estiver on-line
 * no instante do boot vê o número novo no login seguinte.
 */
export async function ressarcirPesca() {
  // Banco novo, criado antes de `db.migrar()` rodar: sem a coluna não há pesca para ressarcir.
  const { rows: temColuna } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'players' AND column_name = 'fishing_skill'`,
  );
  if (!temColuna.length) return { jogadores: 0, diamantes: 0 };

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dia_ledger_pesca_uma_vez
        ON diamante_ledger(player_id) WHERE motivo = '${MOTIVO.PESCA_RESSARCIMENTO}'`);

  return comTransacao(async (cli) => {
    // Chave fixa: serializa os gateways que subirem juntos. Cai sozinha no fim da transação.
    await cli.query(`SELECT pg_advisory_xact_lock(hashtext('ressarcimento-pesca'))`);
    const { rows } = await cli.query(
      `WITH alvo AS (
         SELECT p.id, p.fishing_skill::bigint AS niveis
           FROM players p
          WHERE p.fishing_skill > 0
            AND NOT EXISTS (
                  SELECT 1 FROM diamante_ledger d
                   WHERE d.player_id = p.id AND d.motivo = $1)
       ),
       pago AS (
         UPDATE players p SET diamonds = p.diamonds + a.niveis
           FROM alvo a WHERE p.id = a.id
        RETURNING p.id, a.niveis, p.diamonds AS saldo_apos
       )
       INSERT INTO diamante_ledger (player_id, delta, saldo_apos, motivo, ref, nota)
       SELECT id, niveis, saldo_apos, $1, $2, 'Ressarcimento da Pesca — 1 diamante por nível'
         FROM pago
       RETURNING delta`,
      [MOTIVO.PESCA_RESSARCIMENTO, REF_RESSARCIMENTO_PESCA],
    );
    const diamantes = rows.reduce((s, r) => s + Number(r.delta), 0);
    if (rows.length) {
      console.log(
        `[diamantes] ressarcimento da Pesca: ${rows.length} jogadores · ${diamantes} diamantes`,
      );
    }
    return { jogadores: rows.length, diamantes };
  });
}

/**
 * Move diamantes de um jogador, dentro de uma transação já aberta.
 *
 * Não é exportada, pelo mesmo motivo da irmã em `orbs-db.mjs`: mover a moeda fora de uma
 * transação é justamente o erro que este arquivo existe para impedir.
 *
 * A checagem `>= 0` mora no `WHERE`, não em JavaScript. Dois cliques no mesmo produto viram
 * dois UPDATEs, e é o banco que decide qual dos dois encontra saldo — uma checagem antes do
 * UPDATE não fecha essa janela.
 */
async function movimentar(cli, playerId, delta, motivo, ref = null, nota = null) {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error('delta de diamante tem de ser inteiro e não-zero');
  }
  const { rows } = await cli.query(
    `UPDATE players SET diamonds = diamonds + $2
      WHERE id = $1 AND diamonds + $2 >= 0
      RETURNING diamonds`,
    [playerId, delta],
  );
  if (!rows.length) throw new Error('saldo de diamantes insuficiente');

  const saldo = Number(rows[0].diamonds);
  await cli.query(
    `INSERT INTO diamante_ledger (player_id, delta, saldo_apos, motivo, ref, nota)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [playerId, delta, saldo, motivo, ref, nota],
  );
  return saldo;
}

/**
 * O mesmo `movimentar`, para quem já tem uma transação aberta e precisa mover diamante DENTRO
 * dela.
 *
 * A regra do arquivo continua de pé — mover a moeda fora de uma transação é o erro que ele
 * existe para impedir —, e é justamente por isso que o parâmetro `cli` é obrigatório: quem
 * chama tem de estar num `BEGIN`, e o tipo da chamada diz isso.
 *
 * Nasceu para a abertura da Caixa de Fundador (`caixas-db.mjs`), em que carimbar a caixa como
 * aberta e devolver os diamantes de dentro dela têm de acontecer juntos ou não acontecer: em
 * duas transações, um processo que caísse no meio deixaria uma caixa gasta sem ter pago.
 */
export { movimentar as movimentarNaTransacao };

/** Roda `fn` numa transação, com COMMIT/ROLLBACK garantidos. */
async function comTransacao(fn) {
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    const r = await fn(cli);
    await cli.query('COMMIT');
    return r;
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}

export const saldoDe = async (playerId) => {
  const { rows } = await pool.query(`SELECT diamonds FROM players WHERE id = $1`, [playerId]);
  return Number(rows[0]?.diamonds ?? 0);
};

// ----------------------------------------------------------------- pagamento

/**
 * Registra a intenção de compra. Ainda não credita nada — só o webhook credita.
 *
 * `aceite_em` é carimbado com o `now()` do banco, e não com um horário vindo do cliente: o
 * que se quer provar é QUANDO o servidor recebeu a declaração, não o que o navegador diz.
 */
export async function registrarPendente({
  referencia, playerId, nick, qtd, centavos, metodo, provedor, provedorRef,
  tomadorCpf, tomadorEmail,
}) {
  await pool.query(
    `INSERT INTO diamante_pagamentos
       (referencia, player_id, nick, qtd, centavos, metodo, provedor, provedor_ref, status,
        aceite_em, tomador_cpf, tomador_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,$11)`,
    [referencia, playerId, nick, qtd, centavos, metodo, provedor, provedorRef ?? null,
      // O CPF entra CIFRADO. É o único documento que este banco guarda, e o lugar de onde
      // ele escapa não é a rede (o Postgres está no loopback) — é o backup. Ver `cofre.mjs`.
      PAGAMENTO.PENDENTE, cifrar(tomadorCpf ?? null), tomadorEmail ?? null],
  );
}

export async function pagamentoPorReferencia(referencia) {
  const { rows } = await pool.query(
    `SELECT * FROM diamante_pagamentos WHERE referencia = $1`,
    [referencia],
  );
  return rows[0] ? deLinha(rows[0]) : null;
}

const deLinha = (r) => ({
  referencia: r.referencia,
  playerId: Number(r.player_id),
  nick: r.nick,
  qtd: Number(r.qtd),
  centavos: Number(r.centavos),
  metodo: r.metodo,
  provedor: r.provedor,
  provedorRef: r.provedor_ref,
  status: r.status,
  entregue: r.entregue,
  criadoEm: r.criado_em,
  pagoEm: r.pago_em,
  aceiteEm: r.aceite_em,
  // `decifrar` devolve texto puro como veio, então as linhas gravadas antes da cifra
  // continuam legíveis sem migração nenhuma.
  tomadorCpf: decifrar(r.tomador_cpf),
  tomadorNome: r.tomador_nome,
  tomadorEmail: r.tomador_email,
});

/**
 * Confirma um pagamento e CREDITA os diamantes, numa transação só.
 *
 * `centavosRecebidos` é o que o provedor diz ter recebido, e é conferido contra o que foi
 * cobrado: um pagamento parcial (ou uma referência reaproveitada para um valor menor) não
 * entrega o pacote inteiro. Aceita PARA MAIS — quem pagou a mais já pagou, e recusar seria
 * ficar com o dinheiro sem entregar o produto.
 *
 * A quantidade é RECALCULADA a partir do preço na hora do crédito, e não lida da linha: assim
 * uma linha adulterada por outro caminho não vira diamante de graça.
 *
 * @returns {{creditado:boolean, saldo?:number, pagamento?:object}}
 */
export function confirmarPagamento({ referencia, centavosRecebidos, comprovante, nomePagador }) {
  return comTransacao(async (cli) => {
    // A transição pendente → pago é o cadeado de idempotência. Webhook reenviado, webhook e
    // reconciliação juntos, dois gateways ao mesmo tempo: só o primeiro acha a linha pendente.
    //
    // `tomador_nome` é preenchido AQUI, com o nome que o provedor devolveu — só se ainda não
    // houver um (COALESCE), para a reconciliação não apagar um nome que o webhook já trouxe.
    const { rows } = await cli.query(
      `UPDATE diamante_pagamentos
          SET status = $2, comprovante = $3, pago_em = now(),
              tomador_nome = COALESCE(tomador_nome, $5)
        WHERE referencia = $1 AND status = $4
        RETURNING *`,
      [referencia, PAGAMENTO.PAGO, comprovante ?? null, PAGAMENTO.PENDENTE,
        (nomePagador ?? '').trim() || null],
    );
    if (!rows.length) return { creditado: false };

    const pag = deLinha(rows[0]);
    if (centavosRecebidos != null && centavosRecebidos < pag.centavos) {
      // Pagou menos do que a cobrança: aborta a transação inteira, então a linha volta a
      // `pendente` e um pagamento correto depois ainda funciona.
      throw new Error(`pagamento parcial (${centavosRecebidos} < ${pag.centavos})`);
    }
    if (precoEmCentavos(pag.qtd) !== pag.centavos) {
      throw new Error('preço da linha não bate com a tabela');
    }

    const saldo = await movimentar(
      cli, pag.playerId, pag.qtd, MOTIVO.COMPRA, referencia,
      `${pag.centavos / 100} BRL via ${pag.provedor}`,
    );
    return { creditado: true, saldo, pagamento: pag };
  });
}

// -------------------------------------------------------------- caixa postal

/**
 * Quais destes jogadores têm crédito esperando para ser recolhido.
 *
 * Uma consulta para o shard inteiro, e não uma por jogador — mesma economia da varredura do
 * Mercado: com mil pessoas online é a diferença entre 1 e 1000 consultas por minuto.
 */
export async function jogadoresComCredito(playerIds) {
  if (!playerIds.length) return new Set();
  const { rows } = await pool.query(
    `SELECT DISTINCT player_id FROM diamante_pagamentos
      WHERE status = $1 AND entregue = false AND player_id = ANY($2::bigint[])`,
    [PAGAMENTO.PAGO, playerIds],
  );
  return new Set(rows.map((r) => Number(r.player_id)));
}

/**
 * Recolhe o que a caixa postal tiver para um jogador.
 *
 * Os diamantes JÁ foram creditados no ledger pelo webhook — aqui não se soma nada. O que esta
 * função faz é (a) marcar as linhas como entregues e (b) devolver o saldo verdadeiro para o sim
 * atualizar o cache da tela e avisar o jogador. Somar aqui creditaria duas vezes.
 */
export async function recolherCreditos(playerId) {
  const { rows } = await pool.query(
    `UPDATE diamante_pagamentos SET entregue = true
      WHERE player_id = $1 AND status = $2 AND entregue = false
      RETURNING referencia, qtd, centavos, metodo`,
    [playerId, PAGAMENTO.PAGO],
  );
  if (!rows.length) return { recibos: [] };
  return {
    recibos: rows.map((r) => ({
      referencia: r.referencia,
      qtd: Number(r.qtd),
      centavos: Number(r.centavos),
      metodo: r.metodo,
    })),
    saldo: await saldoDe(playerId),
  };
}

/** Pagamentos pendentes que ainda vale a pena perguntar ao provedor. */
export async function pendentesParaReconciliar(limite = 50) {
  const { rows } = await pool.query(
    `SELECT * FROM diamante_pagamentos
      WHERE status = $1 AND criado_em > now() - interval '24 hours'
      ORDER BY criado_em LIMIT $2`,
    [PAGAMENTO.PENDENTE, limite],
  );
  return rows.map(deLinha);
}

/** O pendente mais recente de um jogador — a tela usa para oferecer "retomar pagamento". */
export async function pendenteDoJogador(playerId) {
  const { rows } = await pool.query(
    `SELECT * FROM diamante_pagamentos
      WHERE player_id = $1 AND status = $2 AND criado_em > now() - interval '24 hours'
      ORDER BY criado_em DESC LIMIT 1`,
    [playerId, PAGAMENTO.PENDENTE],
  );
  return rows[0] ? deLinha(rows[0]) : null;
}

// ---------------------------------------------------------------- loja

/**
 * Debita a compra de um produto da Loja.
 *
 * QUEIMA o diamante: ele sai de circulação e não volta. É o fim da linha da moeda — comprada
 * com dinheiro de verdade, gasta no jogo, e pronto.
 */
export function gastarNaLoja({ playerId, diamantes, produtoId, nome }) {
  return comTransacao(async (cli) => {
    const saldo = await movimentar(cli, playerId, -diamantes, MOTIVO.LOJA, produtoId, nome ?? null);
    return { saldo };
  });
}

/** Devolve o que foi gasto — usado quando o efeito falha DEPOIS do débito. */
export function estornarCompra({ playerId, diamantes, produtoId, nota }) {
  return comTransacao(async (cli) => {
    const saldo = await movimentar(cli, playerId, diamantes, MOTIVO.LOJA_ESTORNO, produtoId, nota ?? null);
    return { saldo };
  });
}

/** Ajuste manual pelo painel — ledger + cache, com nota de quem autorizou (qtd negativa = débito). */
export function creditarAdmin({ playerId, qtd, nota }) {
  if (!Number.isInteger(qtd) || qtd === 0) throw new Error('quantidade inválida');
  return comTransacao(async (cli) => {
    const saldo = await movimentar(cli, playerId, qtd, MOTIVO.AJUSTE_ADMIN, null, nota ?? null);
    return { saldo };
  });
}

/**
 * Paga o pódio do ranking Global de guilds — todo mundo numa transação só.
 *
 * `jogadores`: `[{ playerId, qtd, guildNome, pos }]`, já montado por `game/guild-global.mjs`
 * (um item por MEMBRO, não por guild). `ref` é o mês (`'YYYY-MM'`), para o extrato mostrar de
 * qual fechamento veio o crédito.
 */
export function creditarPremioGuildGlobal({ jogadores, mes }) {
  return comTransacao(async (cli) => {
    const resultados = [];
    for (const j of jogadores) {
      const saldo = await movimentar(
        cli, j.playerId, j.qtd, MOTIVO.GUILD_GLOBAL, mes,
        `TOP ${j.pos} do ranking Global de guilds (${j.guildNome}) — ${mes}`,
      );
      resultados.push({ playerId: j.playerId, saldo });
    }
    return resultados;
  });
}

// ------------------------------------------------- a cota de venda no Mercado

/**
 * Quantos diamantes deste jogador podem ir para o Mercado da Comunidade.
 *
 * ### Por que a conta é CRONOLÓGICA, e não uma soma
 *
 * A primeira versão somava: `cota = Σ(compra + afiliado) − o que já foi a anúncio`, e o
 * vendável era `min(saldo, cota)`. Parecia fechar dos dois lados — e tinha um buraco que um
 * jogador achou em produção no primeiro dia:
 *
 *     compra +10 · Loja −10 · voto +1 · compra +50 · Loja −50 · voto +1
 *     saldo = 2 (os dois de VOTO)   ·   cota = 60 (as duas compras da vida inteira)
 *     min(2, 60) = 2  →  ele podia anunciar os dois diamantes de VOTO
 *
 * O erro é que a soma não tem ORDEM. Gastar na Loja tirava do saldo mas não da cota, então
 * cada diamante comprado e gasto deixava para trás um "direito de vender" que o brinde
 * seguinte ocupava. Na prática a regra virava "você pode vender o que tiver na carteira, até o
 * teto do que já comprou na vida" — e não "você pode vender o que comprou".
 *
 * ### O modelo certo: dois baldes, percorridos na ordem
 *
 * `comprados` e `brindes`, aplicando cada linha do ledger na ordem em que aconteceu:
 *
 *   entrada de COMPRA ou AFILIADO  → entra em `comprados`
 *   qualquer outra entrada         → entra em `brindes` (voto, pódio de guild, caixa,
 *                                    ajuste da administração, e o diamante COMPRADO DE OUTRO
 *                                    JOGADOR no Mercado, que também não pode ser revendido)
 *   saída para a Loja (ou débito)  → come o BRINDE primeiro, e só depois o comprado
 *   saída para ESCROW              → come o comprado (é o único que a regra deixa anunciar)
 *
 * "Brinde primeiro" é a interpretação generosa: quem tem 10 comprados e 5 de voto e gasta 5 na
 * Loja continua com os 10 vendáveis. A alternativa (comer o comprado primeiro) puniria quem
 * usa o brinde exatamente para o que ele existe.
 *
 * ### O carimbo do reset do beta
 *
 * `ajuste_admin` com `ref = 'reset_beta'` não é entrada nem saída: é o
 * `restaurarCompradosNaTransacao` CARIMBANDO o saldo no total comprado. Depois dele, tudo o que
 * o jogador tem é, por definição, diamante comprado — então os dois baldes são reescritos, e
 * não somados. Sem este caso, os 1.679 resets do beta seriam lidos como brinde e a cota de
 * meio servidor iria a zero.
 *
 * ### O custo
 *
 * Uma varredura do ledger DAQUELE jogador, ordenada por `id`. É uma leitura por clique em
 * "Diamantes" na tela de anunciar e uma por publicação — não por tick, não por snapshot. O
 * ledger é append-only e a mediana é de ~9 linhas por jogador (o mais pesado do servidor tem
 * ~100); o índice `idx_dia_ledger_player` já cobre exatamente este `WHERE ... ORDER BY id`.
 *
 * ### A corrida, e onde ela é fechada
 *
 * Dois anúncios simultâneos do mesmo vendedor leriam a mesma cota e escrowariam os dois. Quem
 * fecha isso é o `pg_advisory_xact_lock` por vendedor que `criarAnuncio` já toma ANTES de
 * chegar aqui (ver `market-db.mjs`) — esta função é chamada de dentro daquela transação, com o
 * lock na mão. O saldo tem ainda a sua própria trava, no `WHERE` do `movimentar`.
 */
export async function saldoVendavelDeDiamantes(cli, playerId) {
  const { rows } = await cli.query(
    `SELECT delta, saldo_apos, motivo, ref FROM diamante_ledger
      WHERE player_id = $1 ORDER BY id`,
    [playerId],
  );
  const { rows: pl } = await cli.query(`SELECT diamonds FROM players WHERE id = $1`, [playerId]);
  const saldo = Number(pl[0]?.diamonds ?? 0);

  // Quanto está preso em anúncios ABERTOS agora.
  //
  // Sai da tabela de anúncios, e NÃO de uma soma do ledger. A soma (escrow − devolução) parece
  // equivalente e não é: numa VENDA concluída o escrow do vendedor nunca é revertido — os
  // diamantes vão para o comprador com `MERCADO_COMPRA`, e não há linha de volta do lado de
  // quem vendeu. Somando, tudo o que ele já vendeu na vida continuaria contado como "preso num
  // anúncio", e o número na tela só crescia. Perguntar aos anúncios abertos responde a pergunta
  // que foi feita.
  const { rows: abertos } = await cli.query(
    `SELECT coalesce(sum(qtd), 0)::int AS n FROM market_anuncios
      WHERE vendedor_id = $1 AND tipo = 'diamante' AND estado = 'aberto'`,
    [playerId],
  );
  const emAnuncios = Number(abertos[0]?.n ?? 0);

  let comprados = 0;
  let brindes = 0;
  let deCompra = 0;
  let deAfiliado = 0;

  for (const r of rows) {
    const delta = Number(r.delta) || 0;
    if (r.motivo === MOTIVO.COMPRA) deCompra += delta;
    if (r.motivo === MOTIVO.AFILIADO) deAfiliado += delta;

    // O reset do beta reescreve os dois baldes — ver o cabeçalho.
    if (r.motivo === MOTIVO.AJUSTE_ADMIN && r.ref === 'reset_beta') {
      comprados = Math.max(0, Number(r.saldo_apos) || 0);
      brindes = 0;
      continue;
    }

    if (delta > 0) {
      // A DEVOLUÇÃO volta para o balde de onde o escrow tirou. Ela não "enche a cota" (não é
      // dinheiro novo entrando), é o desfazer de uma saída — e mandá-la para o brinde, como
      // qualquer outra entrada que não é compra, apagaria a cota de quem cancelou um anúncio.
      if (r.motivo === MOTIVO.MERCADO_DEVOLUCAO) comprados += delta;
      else if (MOTIVOS_QUE_ENCHEM_A_COTA.has(r.motivo)) comprados += delta;
      // `loja_estorno` cai aqui, no balde do brinde. São quatro linhas na história inteira do
      // servidor, e devolver ao balde comprado exigiria saber de qual dos dois a compra saiu —
      // o que o ledger não guarda. Contar como brinde só pode ERRAR PARA MENOS na cota, que é
      // o lado seguro do arredondamento.
      else brindes += delta;
      continue;
    }

    let sai = -delta;
    if (r.motivo === MOTIVO.MERCADO_ESCROW) {
      // O escrow só deveria sair do comprado. Se sair mais do que há, o excedente é brinde que
      // escapou por um furo — `comprados` fica negativo de propósito, para a conta abaixo não
      // devolver cota que não existe.
      comprados -= sai;
      continue;
    }
    const doBrinde = Math.min(brindes, sai);
    brindes -= doBrinde;
    sai -= doBrinde;
    comprados -= sai;
  }

  return {
    saldo,
    cota: Math.max(0, comprados),
    // O número que a tela usa e que o anúncio respeita. O `min` com o saldo continua ali: o
    // balde diz quanto é DELE por direito, e o saldo, quanto ainda EXISTE.
    vendavel: Math.max(0, Math.min(saldo, comprados)),
    // A decomposição, só para a tela poder explicar de onde veio a cota.
    deCompra,
    deAfiliado,
    emAnuncios,
    // Quanto do saldo é BRINDE (voto, pódio, ajuste, comprado de outro jogador). A tela usa
    // para dizer, com todas as letras, por que o número vendável é menor que a carteira.
    brindes: Math.max(0, saldo - Math.max(0, comprados)),
  };
}

/** Atalho fora de transação, para a tela perguntar sem abrir nada. */
export const cotaDeVendaDoJogador = (playerId) => saldoVendavelDeDiamantes(pool, playerId);

/** Soma de diamantes comprados (pagamentos confirmados) — usado no painel e no reset beta. */
export async function totalComprado(cli, playerId) {
  const { rows } = await cli.query(
    `SELECT coalesce(sum(qtd), 0)::bigint AS total
       FROM diamante_pagamentos
      WHERE player_id = $1 AND status = $2`,
    [playerId, PAGAMENTO.PAGO],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Atalho fora de transação — o sim chama isto; `totalComprado(cli, …)` fica para o admin. */
export function totalCompradoDoJogador(playerId) {
  return totalComprado(pool, playerId);
}

/**
 * Ban hard: ajusta o saldo para o total comprado (não devolve o que foi gasto na Loja).
 * Roda dentro da transação do admin — orbs ficam como estão (saldo atual, não depositado).
 */
export async function restaurarCompradosNaTransacao(cli, playerId, nota) {
  const alvo = await totalComprado(cli, playerId);
  const { rows } = await cli.query(`SELECT diamonds FROM players WHERE id = $1`, [playerId]);
  const atual = Number(rows[0]?.diamonds ?? 0);
  const delta = alvo - atual;
  if (delta === 0) return { saldo: atual, delta: 0 };
  const saldo = await movimentar(cli, playerId, delta, MOTIVO.AJUSTE_ADMIN, 'reset_beta', nota);
  return { saldo, delta };
}

// --------------------------------------------------------------- extrato

export async function extratoDoJogador(playerId, limite = 30) {
  const { rows } = await pool.query(
    `SELECT delta, saldo_apos, motivo, ref, nota, criado_em
       FROM diamante_ledger WHERE player_id = $1 ORDER BY id DESC LIMIT $2`,
    [playerId, limite],
  );
  return rows.map((r) => ({
    delta: Number(r.delta),
    saldo: Number(r.saldo_apos),
    motivo: r.motivo,
    ref: r.ref,
    nota: r.nota,
    em: r.criado_em,
  }));
}

// ----------------------------------------------------------- auditoria

/**
 * O cache bate com o ledger?
 *
 * Em operação normal a lista é vazia. Qualquer linha aqui significa que algum caminho mexeu em
 * `players.diamonds` sem passar por `movimentar` — e o suspeito número um é o `flushJogadores`
 * ter voltado a gravar a coluna.
 */
export async function conferirSaldo(limite = 50) {
  const { rows } = await pool.query(
    `SELECT p.id, p.nick, p.diamonds AS cache, COALESCE(l.soma, 0) AS ledger
       FROM players p
       LEFT JOIN (SELECT player_id, SUM(delta) AS soma FROM diamante_ledger GROUP BY player_id) l
              ON l.player_id = p.id
      WHERE p.diamonds <> COALESCE(l.soma, 0)
      LIMIT $1`,
    [limite],
  );
  return rows.map((r) => ({
    id: Number(r.id), nick: r.nick, cache: Number(r.cache), ledger: Number(r.ledger),
  }));
}

/** Emissão por motivo, para o teste de invariante. */
export async function totaisPorMotivo() {
  const { rows } = await pool.query(`SELECT motivo, SUM(delta) AS v FROM diamante_ledger GROUP BY motivo`);
  const out = {};
  for (const r of rows) out[r.motivo] = Number(r.v);
  return out;
}

/** Faturamento confirmado, em centavos. O outro lado da conta da emissão. */
export async function faturamentoCentavos() {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(centavos),0) AS v, COUNT(*) AS n
       FROM diamante_pagamentos WHERE status = $1`,
    [PAGAMENTO.PAGO],
  );
  return { centavos: Number(rows[0].v), pagamentos: Number(rows[0].n) };
}
