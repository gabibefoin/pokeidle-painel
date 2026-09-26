// Auditoria de jogador — depósitos, compras e picos de coins para o painel admin.
//
// Coins ≥ LIMITE_COINS_AUDIT num único movimento vão para `player_audit_log` (append-only).
// Gemas, compras PIX e gastos na loja vêm dos registros que já existem (`orb_depositos`,
// `diamante_pagamentos`, `diamante_ledger`, `orb_ledger`) e entram na timeline na consulta.
import { pool } from './db.mjs';
import { MOTIVO as MOTIVO_DIA } from './game/diamantes.mjs';
import { MOTIVO as MOTIVO_ORB } from './game/orbs.mjs';

/** Um movimento de coins acima disto gera linha em `player_audit_log`. */
export const LIMITE_COINS_AUDIT = 1_000_000;

const ROTULO_ORIGEM = {
  deposito: 'Depósito de Gema (USDT → ORB)',
  compra: 'Compra de diamantes (PIX/cartão)',
  loja: 'Loja de diamantes (gasto)',
  loja_estorno: 'Loja — estorno',
  hunt: 'Hunt (kill + auto-venda NPC)',
  npc_item: 'NPC — venda de item',
  npc_pokemon: 'NPC — venda de pokémon',
  npc_lote: 'NPC — venda em lote',
  market_comunidade: 'Mercado da comunidade — recebeu',
  market_compra: 'Mercado da comunidade — comprou',
  market_pendente: 'Mercado da comunidade — venda pendente',
  market_estorno: 'Mercado — estorno ao comprador',
  market_desconto: 'Mercado — reembolso de desconto',
  afiliado_recolher: 'Indique & Ganhe — recolher comissão',
  admin_credito: 'Crédito de diamantes (admin)',
  admin_debito: 'Débito de diamantes (admin)',
  admin: 'Ajuste admin',
  saque_gema: 'Saque de gemas',
  saque_estorno: 'Saque de gemas — estorno',
  loja_gema: 'Loja (gemas)',
  loja_estorno_gema: 'Loja — estorno (gemas)',
  market_taxa_estorno: 'Mercado — estorno de taxa',
  amigo_enviou: 'Amigo — enviou coins (taxa 15%)',
  amigo_recebeu: 'Amigo — recebeu coins',
  amigo_estorno: 'Amigo — estorno de transferência',
};

/** Rótulos das ações de gameplay (`categoria.acao`). */
const ROTULO_ACAO_JOGO = {
  'captura.shiny': 'Captura shiny',
  'captura.p5': 'Captura P5',
  'captura.shiny_p5': 'Captura shiny P5',
  'refino.degrau': 'Refino de stat',
  'fragmento.chave_drop': 'Drop · Fragmento de Chave',
  'fragmento.shiny_drop': 'Drop · Fragmento de Shiny Stone',
  'fragmento.chave_gasto': 'Gasto · Fragmentos de Chave',
  'fragmento.shiny_gasto': 'Gasto · Fragmentos Shiny Stone',
  'evolucao.shiny_stone': 'Evolução shiny (Shiny Stone)',
  'casa.nova': 'Sorteio de casa · nova',
  'casa.upgrade': 'Sorteio de casa · upgrade',
  'casa.mantida': 'Sorteio de casa · mantida',
  'casa.equipar': 'Casa · trocou a equipada',
  'market.anunciado': 'Mercado · anunciou',
  'market.cancelado': 'Mercado · cancelou (devolveu)',
  'market.comprado': 'Mercado · comprou',
  'caixa.comprada': 'Caixa de Fundador · comprou na Loja',
  'caixa.aberta': 'Caixa de Fundador · abriu (outfit + tag + diamantes)',
  'tm.boss_drop': 'Boss · drop de peça TM',
  'npc.venda_item': 'NPC · venda de item',
  'npc.venda_lote': 'NPC · venda em lote',
  'npc.compra': 'NPC · compra na loja',
  'campeonato.inscricao': 'Campeonato · inscreveu-se',
  'campeonato.cancelamento': 'Campeonato · saiu da inscrição',
  'campeonato.equipe': 'Campeonato · escolheu a equipe',
  'conta.email_admin': 'Conta · e-mail trocado pelo painel admin',
  'colecao.entrou': 'Coleção · pokémon enviado para a Coleção',
  'colecao.saiu': 'Coleção · pokémon devolvido ao Depot',
};

/** Filtros de gameplay aceitos em `listarAuditoriaJogador`. */
const FILTROS_JOGO = new Set([
  '',
  'capturas_raras',
  'refino',
  'fragmentos',
  'casa',
  'market',
  'tm',
  'npc',
  'jogo',
]);

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_audit_log (
      id          BIGSERIAL PRIMARY KEY,
      player_id   BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      nick        TEXT   NOT NULL,
      origem      TEXT   NOT NULL,
      valor       BIGINT NOT NULL,
      saldo_apos  BIGINT,
      detalhe     TEXT,
      ref         TEXT,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_audit_player ON player_audit_log(player_id, id DESC)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_audit_nick ON player_audit_log((lower(nick)), id DESC)`,
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_gameplay_log (
      id          BIGSERIAL PRIMARY KEY,
      player_id   BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      nick        TEXT   NOT NULL,
      categoria   TEXT   NOT NULL,
      acao        TEXT   NOT NULL,
      detalhe     TEXT,
      ref         TEXT,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_gameplay_player ON player_gameplay_log(player_id, id DESC)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_gameplay_cat ON player_gameplay_log(player_id, categoria, id DESC)`,
  );
}

/** Grava ação de gameplay — fire-and-forget; nunca bloqueia o tick. */
export function registrarAcaoJogador({ playerId, nick, categoria, acao, detalhe, ref }) {
  if (!playerId || !nick || !categoria || !acao) return;
  pool
    .query(
      `INSERT INTO player_gameplay_log (player_id, nick, categoria, acao, detalhe, ref)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        playerId,
        nick,
        String(categoria).slice(0, 32),
        String(acao).slice(0, 32),
        detalhe ? String(detalhe).slice(0, 800) : null,
        ref ? String(ref).slice(0, 128) : null,
      ],
    )
    .catch((err) => console.error('[audit] gameplay:', err.message));
}

/** Grava pico de coins — fire-and-forget; nunca bloqueia o tick. */
export function registrarCoinGrande({ playerId, nick, valor, saldoApos, origem, detalhe, ref, sempre = false }) {
  if (!playerId || !nick) return;
  const v = Math.floor(Number(valor));
  if (!sempre && v < LIMITE_COINS_AUDIT) return;
  pool
    .query(
      `INSERT INTO player_audit_log (player_id, nick, origem, valor, saldo_apos, detalhe, ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        playerId,
        nick,
        String(origem ?? 'desconhecido').slice(0, 64),
        v,
        saldoApos != null ? Math.floor(Number(saldoApos)) : null,
        detalhe ? String(detalhe).slice(0, 500) : null,
        ref ? String(ref).slice(0, 128) : null,
      ],
    )
    .catch((err) => console.error('[audit] coin grande:', err.message));
}

/**
 * Soma gold na memória e audita se passar do limiar.
 *
 * SÓ CREDITA. Valor <= 0 é descartado de propósito — quem precisa cobrar usa
 * `subtrairGold`. Passar um negativo aqui já foi um buraco de dinheiro infinito: a cobrança
 * virava no-op e o estorno do mesmo valor creditava de verdade (ver `market.criar` no sim).
 *
 * `sempre` força a linha de auditoria mesmo abaixo de `LIMITE_COINS_AUDIT` — é o que impede
 * um crédito repetido logo abaixo do limiar de passar despercebido.
 */
export function somarGoldAuditado(p, valor, origem, detalhe = '', ref = null, { sempre = false } = {}) {
  const v = Math.floor(Number(valor));
  if (!(v > 0)) return 0;
  p.gold += v;
  if (sempre || v >= LIMITE_COINS_AUDIT) {
    registrarCoinGrande({
      playerId: p.dbId,
      nick: p.nick,
      valor: v,
      saldoApos: p.gold,
      origem,
      detalhe,
      ref,
      sempre,
    });
  }
  return v;
}

/**
 * Debita gold na memória — o espelho de `somarGoldAuditado` para cobranças.
 *
 * Existe para que cobrar nunca mais seja "somar um negativo": o clamp em zero evita saldo
 * negativo, e o retorno é quanto saiu de fato, para quem precisar estornar exatamente isso.
 */
export function subtrairGold(p, valor) {
  const v = Math.floor(Number(valor));
  if (!(v > 0)) return 0;
  const saiu = Math.min(v, Math.floor(p.gold ?? 0));
  p.gold = Math.floor(p.gold ?? 0) - saiu;
  return saiu;
}

/** Extrai o e-mail do admin de notas como "crédito manual por admin@exemplo.com". */
function extrairAdminDaNota(nota) {
  const bruto = String(nota ?? '').trim();
  if (!bruto) return null;
  const m = bruto.match(/\bpor\s+(\S+@\S+)\s*$/i);
  if (m) return m[1];
  const m2 = bruto.match(/\bpor\s+(.+)$/i);
  return m2?.[1]?.trim() || null;
}

function mapEvento(row) {
  return {
    em: row.em,
    tipo: row.tipo,
    origem: row.origem,
    origemLabel: ROTULO_ORIGEM[row.origem] ?? row.origem,
    valor: row.valor != null ? Number(row.valor) : null,
    saldoApos: row.saldo_apos != null ? Number(row.saldo_apos) : null,
    detalhe: row.detalhe ?? null,
    ref: row.ref ?? null,
  };
}

function mapEventoJogo(row) {
  const chave = `${row.categoria}.${row.acao}`;
  return {
    em: row.em,
    tipo: 'jogo',
    categoria: row.categoria,
    origem: row.acao,
    origemLabel: ROTULO_ACAO_JOGO[chave] ?? chave,
    valor: null,
    saldoApos: null,
    detalhe: row.detalhe ?? null,
    ref: row.ref ?? null,
  };
}

function filtroSqlGameplay(f) {
  if (f === 'capturas_raras') return `categoria = 'captura'`;
  if (f === 'refino') return `categoria = 'refino'`;
  if (f === 'fragmentos') return `categoria = 'fragmento'`;
  if (f === 'casa') return `categoria = 'casa'`;
  if (f === 'market') return `categoria = 'market'`;
  if (f === 'tm') return `categoria = 'tm'`;
  if (f === 'npc') return `categoria = 'npc'`;
  if (f === 'jogo') return 'TRUE';
  return 'TRUE';
}

function filtroIncluiFinanceiro(f) {
  return !f || f === 'market' || f === 'coins' || f === 'gema' || f === 'diamante';
}

function filtroIncluiGameplay(f) {
  return !f || FILTROS_JOGO.has(f);
}

/** Mapeia `orb_ledger.motivo` para a chave de `ROTULO_ORIGEM`. */
function origemDeMotivoOrb(motivo, delta = 0) {
  switch (motivo) {
    case MOTIVO_ORB.COMPRA: return 'deposito';
    case MOTIVO_ORB.SAQUE: return 'saque_gema';
    case MOTIVO_ORB.SAQUE_ESTORNO: return 'saque_estorno';
    case MOTIVO_ORB.MARKET_COMPRA: return 'market_compra';
    case MOTIVO_ORB.MARKET_VENDA: return 'market_comunidade';
    case MOTIVO_ORB.AFILIADO: return 'afiliado_recolher';
    case MOTIVO_ORB.AJUSTE_ADMIN: return Number(delta) >= 0 ? 'admin_credito' : 'admin_debito';
    case MOTIVO_ORB.LOJA: return 'loja_gema';
    case MOTIVO_ORB.LOJA_ESTORNO: return 'loja_estorno_gema';
    default: return String(motivo ?? 'desconhecido');
  }
}

function chaveRecolhimentoEm(em) {
  return Math.floor(new Date(em).getTime() / 1000);
}

function detalheVendaMercado({ descricao, comprador, anuncio_id }) {
  let s = String(descricao ?? 'item').trim();
  if (comprador) s += ` · comprador ${comprador}`;
  if (anuncio_id != null) s += ` · anuncio:${anuncio_id}`;
  return s;
}

/** Agrupa vendas recolhidas por segundo (várias linhas no mesmo recolhimento). */
function indexarVendasOrbRecolhidas(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = chaveRecolhimentoEm(r.em);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

/** Casa ledger ↔ pagamentos quando `criado_em` e `recolhido_em` caem em segundos diferentes. */
function vendasOrbParaLedger(r, vendasOrbRecolhidas) {
  if (!vendasOrbRecolhidas?.size) return null;
  const valorAlvo = Number(r.valor);
  const emAlvo = new Date(r.em).getTime();

  const candidatos = [];
  for (const [k, vendas] of vendasOrbRecolhidas) {
    const soma = vendas.reduce((s, v) => s + Number(v.valor), 0);
    if (soma !== valorAlvo) continue;
    candidatos.push({ dt: Math.abs(k * 1000 - emAlvo), vendas });
  }
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => a.dt - b.dt);
  return candidatos[0].dt <= 5000 ? candidatos[0].vendas : null;
}

function detalheOrbLedger(r, vendasOrbRecolhidas) {
  const nota = r.nota ? String(r.nota) : '';
  const ref = r.ref ? String(r.ref) : '';
  if (r.motivo === MOTIVO_ORB.MARKET_COMPRA) {
    return nota
      ? `Comprou de ${nota}${ref ? ` · ${ref}` : ''}`
      : (ref || 'compra no mercado da comunidade');
  }
  if (r.motivo === MOTIVO_ORB.MARKET_VENDA) {
    if (nota && !/^\d+ venda\(s\)$/.test(nota.trim())) return nota;
    const vendas = vendasOrbParaLedger(r, vendasOrbRecolhidas);
    if (vendas?.length) return vendas.map(detalheVendaMercado).join('; ');
    return nota || ref || 'recolheu da caixa postal do mercado';
  }
  if (r.motivo === MOTIVO_ORB.COMPRA) {
    return nota || ref || 'depósito USDT → gemas';
  }
  if (r.motivo === MOTIVO_ORB.SAQUE || r.motivo === MOTIVO_ORB.SAQUE_ESTORNO) {
    return nota || ref || null;
  }
  return nota || ref || null;
}

/**
 * Timeline unificada de um jogador — economia (gemas, diamantes, mercado, coins) e gameplay.
 *
 * `filtro`: '' | 'gema' | 'diamante' | 'coins' | 'market' | 'capturas_raras' | 'refino' |
 *           'fragmentos' | 'casa' | 'tm' | 'npc' | 'jogo'
 *
 * O log de gameplay (`player_gameplay_log`) só é consultado por esta rota admin — nunca vai
 * para o cliente do jogo.
 */
export async function listarAuditoriaJogador({ nick, limite = 100, filtro = '' } = {}) {
  const pedido = String(nick ?? '').trim();
  if (!pedido) throw new Error('nick obrigatório');

  const { rows: pj } = await pool.query(
    `SELECT id, nick, gold, level FROM players WHERE lower(nick) = lower($1)`,
    [pedido],
  );
  if (!pj[0]) throw new Error('jogador não encontrado');

  const playerId = Number(pj[0].id);
  const canon = pj[0].nick;
  const lim = Math.min(Math.max(Number(limite) || 100, 1), 300);
  const f = String(filtro ?? '').trim();
  const incFin = filtroIncluiFinanceiro(f);
  const incJogo = filtroIncluiGameplay(f);

  const [totOrb, totDia, totLoja, totAffDia, totAffOrb, totAdminDia, totMarketGold, totMarketOrb, totMarketOrbCompras, depositos, diamantes, loja, affDia, affOrb, adminDia, orbLedger, mercado, mercadoPendente, mercadoOrbRecolhido, coinsGrandes, gameplay] =
    await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(orbs),0)::bigint AS orbs,
                COALESCE(SUM(usdt),0)::numeric AS usdt,
                count(*)::int AS n
           FROM orb_depositos WHERE player_id = $1`,
        [playerId],
      ),
      pool.query(
        `SELECT COALESCE(SUM(qtd),0)::bigint AS qtd,
                COALESCE(SUM(centavos),0)::bigint AS centavos,
                count(*)::int AS n
           FROM diamante_pagamentos
          WHERE player_id = $1 AND status = 'pago'`,
        [playerId],
      ),
      pool.query(
        `SELECT COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END),0)::bigint AS gasto,
                COALESCE(SUM(CASE WHEN motivo = 'loja_estorno' THEN delta ELSE 0 END),0)::bigint AS estornado,
                count(*) FILTER (WHERE motivo = 'loja')::int AS n_compras,
                count(*) FILTER (WHERE motivo = 'loja_estorno')::int AS n_estornos
           FROM diamante_ledger
          WHERE player_id = $1 AND motivo IN ('loja', 'loja_estorno')`,
        [playerId],
      ),
      pool.query(
        `SELECT COALESCE(SUM(delta),0)::bigint AS qtd, count(*)::int AS n
           FROM diamante_ledger
          WHERE player_id = $1 AND motivo = $2`,
        [playerId, MOTIVO_DIA.AFILIADO],
      ),
      pool.query(
        `SELECT COALESCE(SUM(delta),0)::bigint AS qtd, count(*)::int AS n
           FROM orb_ledger
          WHERE player_id = $1 AND motivo = $2`,
        [playerId, MOTIVO_ORB.AFILIADO],
      ),
      pool.query(
        `SELECT COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END),0)::bigint AS creditado,
                COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END),0)::bigint AS debitado,
                count(*)::int AS n
           FROM diamante_ledger
          WHERE player_id = $1 AND motivo = $2`,
        [playerId, MOTIVO_DIA.AJUSTE_ADMIN],
      ),
      pool.query(
        `SELECT COALESCE(SUM(valor),0)::bigint AS liquido,
                COALESCE(SUM(bruto),0)::bigint AS bruto,
                count(*)::int AS n
           FROM market_pagamentos
          WHERE vendedor_id = $1 AND moeda = 'gold'`,
        [playerId],
      ),
      pool.query(
        `SELECT COALESCE(SUM(valor),0)::bigint AS liquido,
                COALESCE(SUM(bruto),0)::bigint AS bruto,
                count(*)::int AS n
           FROM market_pagamentos
          WHERE vendedor_id = $1 AND moeda = 'orb'`,
        [playerId],
      ),
      pool.query(
        `SELECT COALESCE(SUM(bruto),0)::bigint AS bruto,
                count(*)::int AS n
           FROM market_pagamentos
          WHERE comprador_id = $1 AND moeda = 'orb'`,
        [playerId],
      ),
      f === 'gema' || f === 'diamante' || f === 'coins' || f === 'market' || !incFin
        ? { rows: [] }
        : pool.query(
            `SELECT criado_em AS em, orbs AS valor, usdt, tx_hash, referencia
               FROM orb_depositos
              WHERE player_id = $1
              ORDER BY id DESC LIMIT $2`,
            [playerId, lim],
          ),
      f === 'gema' || f === 'coins' || f === 'market' || !incFin
        ? { rows: [] }
        : pool.query(
            `SELECT COALESCE(pago_em, criado_em) AS em, qtd AS valor, centavos,
                    metodo, provedor, referencia
               FROM diamante_pagamentos
              WHERE player_id = $1 AND status = 'pago'
              ORDER BY criado_em DESC LIMIT $2`,
            [playerId, lim],
          ),
      f === 'gema' || f === 'coins' || f === 'market' || !incFin
        ? { rows: [] }
        : pool.query(
            `SELECT criado_em AS em, delta AS valor, saldo_apos, motivo, ref, nota
               FROM diamante_ledger
              WHERE player_id = $1 AND motivo IN ('loja', 'loja_estorno')
              ORDER BY id DESC LIMIT $2`,
            [playerId, lim],
          ),
      f === 'gema' || f === 'coins' || f === 'market' || !incFin
        ? { rows: [] }
        : pool.query(
            `SELECT criado_em AS em, delta AS valor, saldo_apos, ref, nota
               FROM diamante_ledger
              WHERE player_id = $1 AND motivo = $2
              ORDER BY id DESC LIMIT $3`,
            [playerId, MOTIVO_DIA.AFILIADO, lim],
          ),
      f === 'diamante' || f === 'coins' || f === 'market' || f === 'gema' || !incFin
        ? { rows: [] }
        : pool.query(
            `SELECT criado_em AS em, delta AS valor, saldo_apos, ref, nota
               FROM orb_ledger
              WHERE player_id = $1 AND motivo = $2
              ORDER BY id DESC LIMIT $3`,
            [playerId, MOTIVO_ORB.AFILIADO, lim],
          ),
      f === 'gema' || f === 'coins' || f === 'market' || !incFin
        ? { rows: [] }
        : pool.query(
            `SELECT criado_em AS em, delta AS valor, saldo_apos, ref, nota
               FROM diamante_ledger
              WHERE player_id = $1 AND motivo = $2
              ORDER BY id DESC LIMIT $3`,
            [playerId, MOTIVO_DIA.AJUSTE_ADMIN, lim],
          ),
      f === 'gema'
        ? pool.query(
            `SELECT criado_em AS em, delta AS valor, saldo_apos, motivo, ref, nota
               FROM orb_ledger
              WHERE player_id = $1
              ORDER BY id DESC LIMIT $2`,
            [playerId, lim],
          )
        : { rows: [] },
      f === 'gema' || f === 'diamante' || !incFin || (f !== 'market' && f !== '' && f !== 'coins')
        ? { rows: [] }
        : pool.query(
            `SELECT criado_em AS em, moeda, valor, bruto, descricao, comprador, anuncio_id
               FROM market_pagamentos
              WHERE vendedor_id = $1${
                f === 'coins' ? " AND moeda = 'gold'" : ''
              }
              ORDER BY id DESC LIMIT $2`,
            [playerId, lim],
          ),
      f === 'gema'
        ? pool.query(
            `SELECT criado_em AS em, valor, bruto, descricao, comprador, anuncio_id
               FROM market_pagamentos
              WHERE vendedor_id = $1 AND moeda = 'orb' AND recolhido_em IS NULL
              ORDER BY id DESC LIMIT $2`,
            [playerId, lim],
          )
        : { rows: [] },
      f === 'gema'
        ? pool.query(
            `SELECT recolhido_em AS em, valor, bruto, descricao, comprador, anuncio_id
               FROM market_pagamentos
              WHERE vendedor_id = $1 AND moeda = 'orb' AND recolhido_em IS NOT NULL
              ORDER BY recolhido_em DESC, id DESC LIMIT $2`,
            [playerId, Math.min(lim * 5, 500)],
          )
        : { rows: [] },
      f === 'gema' || f === 'diamante' || f === 'market' || !incFin
        ? { rows: [] }
        : pool.query(
            `SELECT criado_em AS em, origem, valor, saldo_apos, detalhe, ref
               FROM player_audit_log
              WHERE player_id = $1
              ORDER BY id DESC LIMIT $2`,
            [playerId, lim],
          ),
      !incJogo
        ? { rows: [] }
        : pool.query(
            `SELECT criado_em AS em, categoria, acao, detalhe, ref
               FROM player_gameplay_log
              WHERE player_id = $1 AND ${filtroSqlGameplay(f)}
              ORDER BY id DESC LIMIT $2`,
            [playerId, lim],
          ),
    ]);

  const eventos = [];

  for (const r of depositos.rows) {
    eventos.push(
      mapEvento({
        em: r.em,
        tipo: 'gema',
        origem: 'deposito',
        valor: Number(r.valor),
        detalhe: `${Number(r.usdt).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT${r.tx_hash ? ` · ${String(r.tx_hash).slice(0, 16)}…` : ''}`,
        ref: r.referencia ?? r.tx_hash,
      }),
    );
  }

  for (const r of diamantes.rows) {
    const centavos = Number(r.centavos ?? 0);
    eventos.push(
      mapEvento({
        em: r.em,
        tipo: 'diamante',
        origem: 'compra',
        valor: Number(r.valor),
        detalhe: `${r.metodo} · ${r.provedor} · ${(centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
        ref: r.referencia,
      }),
    );
  }

  for (const r of loja.rows) {
    const estorno = r.motivo === 'loja_estorno';
    const produto = r.nota || r.ref || 'produto';
    eventos.push(
      mapEvento({
        em: r.em,
        tipo: 'diamante',
        origem: estorno ? 'loja_estorno' : 'loja',
        valor: Number(r.valor),
        saldo_apos: r.saldo_apos,
        detalhe: estorno
          ? `Estorno: ${produto}${r.ref ? ` · ${r.ref}` : ''}`
          : `${produto}${r.ref ? ` · ${r.ref}` : ''}`,
        ref: r.ref,
      }),
    );
  }

  for (const r of affDia.rows) {
    eventos.push(
      mapEvento({
        em: r.em,
        tipo: 'diamante',
        origem: 'afiliado_recolher',
        valor: Number(r.valor),
        saldo_apos: r.saldo_apos,
        detalhe: r.nota || `Comissão de indicação${r.ref ? ` · ${r.ref}` : ''}`,
        ref: r.ref,
      }),
    );
  }

  for (const r of affOrb.rows) {
    eventos.push(
      mapEvento({
        em: r.em,
        tipo: 'gema',
        origem: 'afiliado_recolher',
        valor: Number(r.valor),
        saldo_apos: r.saldo_apos,
        detalhe: r.nota || `Comissão de indicação${r.ref ? ` · ${r.ref}` : ''}`,
        ref: r.ref,
      }),
    );
  }

  for (const r of adminDia.rows) {
    const v = Number(r.valor);
    const credito = v > 0;
    const admin = extrairAdminDaNota(r.nota);
    eventos.push(
      mapEvento({
        em: r.em,
        tipo: 'diamante',
        origem: credito ? 'admin_credito' : 'admin_debito',
        valor: v,
        saldo_apos: r.saldo_apos,
        detalhe: admin
          ? `${credito ? 'Creditado' : 'Debitado'} por ${admin}${r.ref ? ` · ${r.ref}` : ''}`
          : (r.nota || r.ref || 'ajuste manual'),
        ref: r.ref,
      }),
    );
  }

  const vendasOrbRecolhidas = indexarVendasOrbRecolhidas(mercadoOrbRecolhido.rows);

  for (const r of orbLedger.rows) {
    eventos.push(
      mapEvento({
        em: r.em,
        tipo: 'gema',
        origem: origemDeMotivoOrb(r.motivo, r.valor),
        valor: Number(r.valor),
        saldo_apos: r.saldo_apos,
        detalhe: detalheOrbLedger(r, vendasOrbRecolhidas),
        ref: r.ref,
      }),
    );
  }

  for (const r of mercadoPendente.rows) {
    eventos.push(
      mapEvento({
        em: r.em,
        tipo: 'gema',
        origem: 'market_pendente',
        valor: Number(r.valor),
        detalhe: `${r.descricao}${r.comprador ? ` · comprador ${r.comprador}` : ''} (bruto ${Number(r.bruto).toLocaleString('pt-BR')} gemas · pendente na caixa postal)`,
        ref: r.anuncio_id != null ? `anuncio:${r.anuncio_id}` : null,
      }),
    );
  }

  for (const r of mercado.rows) {
    const emGema = r.moeda === 'orb';
    eventos.push(
      mapEvento({
        em: r.em,
        tipo: emGema ? 'gema' : 'coins',
        origem: 'market_comunidade',
        valor: Number(r.valor),
        detalhe: `${r.descricao}${r.comprador ? ` · comprador ${r.comprador}` : ''} (bruto ${Number(r.bruto).toLocaleString('pt-BR')}${emGema ? ' gemas' : ''})`,
        ref: r.anuncio_id != null ? `anuncio:${r.anuncio_id}` : null,
      }),
    );
  }

  for (const r of coinsGrandes.rows) {
    eventos.push(
      mapEvento({
        em: r.em,
        tipo: 'coins',
        origem: r.origem,
        valor: Number(r.valor),
        saldo_apos: r.saldo_apos,
        detalhe: r.detalhe,
        ref: r.ref,
      }),
    );
  }

  for (const r of gameplay.rows) {
    eventos.push(mapEventoJogo(r));
  }

  eventos.sort((a, b) => new Date(b.em) - new Date(a.em));

  const filtrado =
    f === 'gema'
      ? eventos.filter((e) => e.tipo === 'gema')
      : f === 'diamante'
        ? eventos.filter((e) => e.tipo === 'diamante')
        : f === 'market'
          ? eventos.filter(
              (e) => e.origem === 'market_comunidade' || (e.tipo === 'jogo' && e.categoria === 'market'),
            )
          : f === 'coins'
            ? eventos.filter((e) => e.tipo === 'coins')
            : f === 'capturas_raras'
              ? eventos.filter((e) => e.tipo === 'jogo' && e.categoria === 'captura')
              : f === 'refino'
                ? eventos.filter((e) => e.tipo === 'jogo' && e.categoria === 'refino')
                : f === 'fragmentos'
                  ? eventos.filter((e) => e.tipo === 'jogo' && e.categoria === 'fragmento')
                  : f === 'casa'
                    ? eventos.filter((e) => e.tipo === 'jogo' && e.categoria === 'casa')
                    : f === 'tm'
                      ? eventos.filter((e) => e.tipo === 'jogo' && e.categoria === 'tm')
                      : f === 'npc'
                        ? eventos.filter((e) => e.tipo === 'jogo' && e.categoria === 'npc')
                        : f === 'jogo'
                          ? eventos.filter((e) => e.tipo === 'jogo')
                          : eventos;

  return {
    nick: canon,
    level: Number(pj[0].level ?? 0),
    gold: Number(pj[0].gold ?? 0),
    limiteCoinsAudit: LIMITE_COINS_AUDIT,
    resumo: {
      gemasDepositadas: Number(totOrb.rows[0]?.orbs ?? 0),
      depositosGema: Number(totOrb.rows[0]?.n ?? 0),
      usdtDepositado: Number(totOrb.rows[0]?.usdt ?? 0),
      diamantesComprados: Number(totDia.rows[0]?.qtd ?? 0),
      comprasDiamante: Number(totDia.rows[0]?.n ?? 0),
      centavosDiamante: Number(totDia.rows[0]?.centavos ?? 0),
      diamantesGastosLoja: Number(totLoja.rows[0]?.gasto ?? 0),
      diamantesEstornadosLoja: Number(totLoja.rows[0]?.estornado ?? 0),
      comprasLoja: Number(totLoja.rows[0]?.n_compras ?? 0),
      estornosLoja: Number(totLoja.rows[0]?.n_estornos ?? 0),
      diamantesAfiliadoRecolhidos: Number(totAffDia.rows[0]?.qtd ?? 0),
      recolhasAfiliadoDiamante: Number(totAffDia.rows[0]?.n ?? 0),
      gemasAfiliadoRecolhidas: Number(totAffOrb.rows[0]?.qtd ?? 0),
      recolhasAfiliadoGema: Number(totAffOrb.rows[0]?.n ?? 0),
      diamantesAdminCreditados: Number(totAdminDia.rows[0]?.creditado ?? 0),
      diamantesAdminDebitados: Number(totAdminDia.rows[0]?.debitado ?? 0),
      ajustesAdminDiamante: Number(totAdminDia.rows[0]?.n ?? 0),
      coinsMercadoLiquido: Number(totMarketGold.rows[0]?.liquido ?? 0),
      coinsMercadoBruto: Number(totMarketGold.rows[0]?.bruto ?? 0),
      vendasMercado: Number(totMarketGold.rows[0]?.n ?? 0),
      gemasMercadoLiquido: Number(totMarketOrb.rows[0]?.liquido ?? 0),
      gemasMercadoBruto: Number(totMarketOrb.rows[0]?.bruto ?? 0),
      vendasMercadoGema: Number(totMarketOrb.rows[0]?.n ?? 0),
      gemasMercadoGasto: Number(totMarketOrbCompras.rows[0]?.bruto ?? 0),
      comprasMercadoGema: Number(totMarketOrbCompras.rows[0]?.n ?? 0),
    },
    eventos: filtrado.slice(0, lim),
  };
}
