#!/usr/bin/env node
/**
 * Auditoria de Exp. Share (held, item 70050) — quantas foram compradas × quantas existem.
 *
 * A Exp. Share é o único objeto do jogo cuja unidade mora em duas tabelas: parada na bolsa é
 * `players.items['70050']`, equipada é `player_pokemon.held_item_id`. As duas são escritas por
 * mecanismos diferentes dentro do mesmo flush — a bolsa por um SNAPSHOT do inventário em
 * memória, a linha do pokémon por leitura VIVA do objeto —, então qualquer caminho que releia
 * a linha no meio do par pode gravar as duas metades em estados diferentes: a unidade volta
 * para a bolsa E o pokémon continua segurando. Um vira dois.
 *
 * Desde que o item saiu do Mercado (ver `shared/xp-share-held.mjs`) a conta fecha POR JOGADOR,
 * e é isso que torna esta ferramenta barata e conclusiva:
 *
 *     bolsa + equipadas  ==  players.xp_share_total
 *
 * O SERVIDOR já confere isso sozinho em TODO login (`conferirXpShareHeld` em `sim.mjs`), de
 * graça, e corta o excedente antes de o jogador ver o item. Esta ferramenta existe para o que
 * o login não faz:
 *
 *   • varrer quem está off-line há semanas, sem esperar ele voltar;
 *   • mostrar o lado da PERDA (tem menos do que comprou), que o servidor não corrige sozinho;
 *   • conferir a própria coluna `xp_share_total` contra o histórico (ledger da Loja + as duas
 *     pontas do Mercado, de quando ele ainda era negociável). Se as duas contas divergirem, o
 *     problema é da coluna, não do jogador — e cortar seria cortar item de quem pagou.
 *
 * Uso:
 *   node tools/auditar-exp-share.mjs                    relatório (somente leitura)
 *   node tools/auditar-exp-share.mjs --nick Menecito    só um jogador
 *   node tools/auditar-exp-share.mjs --corrigir         remove o excedente de quem está OFF
 *   node tools/auditar-exp-share.mjs --corrigir --min-offline 30
 *
 * `--corrigir` só toca em quem está fora há `--min-offline` minutos (padrão 15; a carência de
 * reconexão do sim é de 90 s e o flush escreve `last_seen` a cada 5 s). Mexer na bolsa de quem
 * está on-line é inútil e perigoso: o inventário dele vive na MEMÓRIA do sim e o flush seguinte
 * grava por cima — é a mesma razão pela qual o Mercado devolve item ao vendedor ausente pelo
 * banco e ao presente pela memória (ver `creditarItemNoBanco` em `market-db.mjs`). Para quem
 * está on-line não há o que fazer aqui: o próximo login dele já corrige.
 */
import { pool } from '../src/server/db.mjs';
import { XP_SHARE_HELD_ID, planoDeCorteXpShare } from '../src/shared/xp-share-held.mjs';

const args = process.argv.slice(2);
const flag = (nome) => args.includes(nome);
const valor = (nome, padrao) => {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};

const corrigir = flag('--corrigir');
const nickAlvo = valor('--nick', null);
const minOffline = Math.max(2, Number(valor('--min-offline', 15)) || 15);

const ID = String(XP_SHARE_HELD_ID);

// ---------------------------------------------------------------- leitura

/**
 * Uma linha por jogador que TEM ou DEVERIA TER pelo menos uma unidade.
 *
 * `direito` é a coluna (a verdade operacional, a mesma que o sim usa no login). `auditado` é o
 * histórico reconstruído — `estado = 'vendido'` é a única transferência que conta, porque
 * `cancelado`/`expirado` devolvem ao próprio vendedor e `aberto` ainda é escrow dele. As duas
 * têm de bater; quando não batem, quem está errado é a coluna.
 */
const SQL_BALANCO = `
WITH compras AS (
  SELECT player_id, COUNT(*)::bigint AS n
    FROM diamante_ledger
   WHERE motivo = 'loja' AND ref = 'xpshareheld'
   GROUP BY 1
), mkt_comprou AS (
  SELECT comprador_id AS player_id, SUM(qtd)::bigint AS n
    FROM market_anuncios
   WHERE tipo = 'item' AND item_id = $1 AND estado = 'vendido' AND comprador_id IS NOT NULL
   GROUP BY 1
), mkt_vendeu AS (
  SELECT vendedor_id AS player_id, SUM(qtd)::bigint AS n
    FROM market_anuncios
   WHERE tipo = 'item' AND item_id = $1 AND estado = 'vendido'
   GROUP BY 1
), escrow AS (
  SELECT vendedor_id AS player_id, SUM(qtd)::bigint AS n
    FROM market_anuncios
   WHERE tipo = 'item' AND item_id = $1 AND estado = 'aberto'
   GROUP BY 1
), bolsa AS (
  SELECT id AS player_id, (items->>$2)::bigint AS n
    FROM players
   WHERE items ? $2 AND (items->>$2)::bigint > 0
), equipado AS (
  SELECT player_id, COUNT(*)::bigint AS n
    FROM player_pokemon
   WHERE held_item_id = $1
   GROUP BY 1
), ids AS (
  SELECT player_id FROM compras
  UNION SELECT player_id FROM mkt_comprou
  UNION SELECT player_id FROM mkt_vendeu
  UNION SELECT player_id FROM escrow
  UNION SELECT player_id FROM bolsa
  UNION SELECT player_id FROM equipado
  UNION SELECT id FROM players WHERE xp_share_total > 0
)
SELECT p.id, p.nick, p.xp_share_total AS direito,
       EXTRACT(EPOCH FROM (now() - p.last_seen))::bigint AS offline_seg,
       COALESCE(c.n,0)  AS comprou_loja,
       COALESCE(mc.n,0) AS comprou_mercado,
       COALESCE(mv.n,0) AS vendeu_mercado,
       COALESCE(b.n,0)  AS bolsa,
       COALESCE(e.n,0)  AS equipado,
       COALESCE(es.n,0) AS escrow,
       COALESCE(c.n,0) + COALESCE(mc.n,0) - COALESCE(mv.n,0) AS auditado
  FROM ids i
  JOIN players p ON p.id = i.player_id
  LEFT JOIN compras     c  ON c.player_id  = i.player_id
  LEFT JOIN mkt_comprou mc ON mc.player_id = i.player_id
  LEFT JOIN mkt_vendeu  mv ON mv.player_id = i.player_id
  LEFT JOIN bolsa       b  ON b.player_id  = i.player_id
  LEFT JOIN equipado    e  ON e.player_id  = i.player_id
  LEFT JOIN escrow      es ON es.player_id = i.player_id
 ORDER BY p.nick`;

const { rows } = await pool.query(SQL_BALANCO, [XP_SHARE_HELD_ID, ID]);

const linhas = rows
  .map((r) => {
    const bolsa = Number(r.bolsa);
    const equipado = Number(r.equipado);
    const escrow = Number(r.escrow);
    const direito = Number(r.direito);
    return {
      id: Number(r.id),
      nick: r.nick,
      offlineSeg: Number(r.offline_seg),
      comprouLoja: Number(r.comprou_loja),
      comprouMercado: Number(r.comprou_mercado),
      vendeuMercado: Number(r.vendeu_mercado),
      bolsa,
      equipado,
      escrow,
      direito,
      auditado: Number(r.auditado),
      emMaos: bolsa + equipado + escrow,
      diferenca: bolsa + equipado + escrow - direito,
    };
  })
  .filter((l) => !nickAlvo || l.nick.toLowerCase() === nickAlvo.toLowerCase());

const soma = (campo) => linhas.reduce((s, l) => s + l[campo], 0);
const n = (v) => String(v).padStart(4);

console.log(`\n=== Exp. Share (item ${ID}) ===\n`);
console.log('  direito somado (xp_share_total) ...', n(soma('direito')));
console.log('  compradas na Loja (50 diamantes) ..', n(soma('comprouLoja')));
console.log('  em circulacao .....................', n(soma('emMaos')));
console.log('    - na bolsa ......................', n(soma('bolsa')));
console.log('    - equipadas num pokemon .........', n(soma('equipado')));
console.log('    - em anuncio aberto (historico) .', n(soma('escrow')));

const excedentes = linhas.filter((l) => l.diferenca > 0);
const faltantes = linhas.filter((l) => l.diferenca < 0);
// Coluna contra histórico. Divergir aqui não é jogador duplicando — é a coluna errada, e
// cortar por ela cortaria item de quem pagou. Por isso estas contas ficam FORA do `--corrigir`.
const suspeitas = linhas.filter((l) => l.direito !== l.auditado);
const totalExcedente = excedentes.reduce((s, l) => s + l.diferenca, 0);
const totalFaltante = faltantes.reduce((s, l) => s - l.diferenca, 0);

console.log('\n  DUPLICADAS ........................', n(totalExcedente),
  excedentes.length ? `em ${excedentes.length} conta(s)` : '');
console.log('  SUMIDAS ...........................', n(totalFaltante),
  faltantes.length ? `em ${faltantes.length} conta(s)` : '');
console.log('  DIREITO x HISTORICO divergente ....', n(suspeitas.length), 'conta(s)');

const tabela = (titulo, lista) => {
  if (!lista.length) return;
  console.log(`\n${titulo}`);
  console.log('  nick               loja mkt+ mkt- bolsa equip escr direito audit  tem  dif  visto ha');
  for (const l of lista) {
    const visto = l.offlineSeg < 120 ? 'ON-LINE'
      : l.offlineSeg < 3600 ? `${Math.round(l.offlineSeg / 60)} min`
        : `${Math.round(l.offlineSeg / 3600)} h`;
    console.log(
      `  ${l.nick.padEnd(18)}${n(l.comprouLoja)} ${n(l.comprouMercado)} ${n(l.vendeuMercado)}`
      + ` ${n(l.bolsa)} ${n(l.equipado)} ${n(l.escrow)} ${n(l.direito)} ${n(l.auditado)} ${n(l.emMaos)}`
      + ` ${(l.diferenca > 0 ? `+${l.diferenca}` : String(l.diferenca)).padStart(4)}  ${visto}`,
    );
  }
};

tabela('Contas com unidade a MAIS (duplicacao):', excedentes);
tabela('Contas com unidade a MENOS (item sumiu):', faltantes);
tabela('Contas em que xp_share_total NAO bate com o historico:', suspeitas);

if (!corrigir) {
  if (totalExcedente) console.log('\n(somente leitura — rode com --corrigir para remover o excedente)');
  await pool.end();
  process.exit(0);
}

// ---------------------------------------------------------------- correção

/**
 * Tira o excedente do jogador, pelo MESMO plano que o servidor usa no login.
 *
 * `planoDeCorteXpShare` mora em `shared/` justamente para isto: se a regra vivesse duas vezes,
 * a ferramenta e o sim poderiam desequipar pokémon diferentes para o mesmo jogador, dependendo
 * de quem chegasse primeiro.
 *
 * Tudo numa transação, e com a checagem de `last_seen` DENTRO dela: entre o relatório e a
 * escrita o jogador pode ter entrado, e aí quem manda é a memória do sim, não esta linha.
 */
async function removerExcedente(l) {
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');

    const { rows: [jog] } = await cli.query(
      `SELECT nick, items, xp_share_total,
              EXTRACT(EPOCH FROM (now() - last_seen))::bigint AS offline_seg
         FROM players WHERE id = $1 FOR UPDATE`,
      [l.id],
    );
    if (!jog) throw new Error('jogador sumiu');
    if (Number(jog.offline_seg) < minOffline * 60) {
      await cli.query('ROLLBACK');
      return { pulado: `visto há ${Math.round(Number(jog.offline_seg) / 60)} min — o login dele corrige` };
    }

    const { rows: segurando } = await cli.query(
      `SELECT id, level FROM player_pokemon
        WHERE player_id = $1 AND held_item_id = $2 AND anuncio_id IS NULL
          FOR UPDATE`,
      [l.id, XP_SHARE_HELD_ID],
    );

    const bolsa = Number(jog.items?.[ID] ?? 0);
    const plano = planoDeCorteXpShare({
      bolsa,
      equipados: segurando.map((k) => ({ id: Number(k.id), level: Number(k.level) })),
      direito: Number(jog.xp_share_total),
    });
    if (!plano.excedente) {
      await cli.query('ROLLBACK');
      return { pulado: 'já estava certo' };
    }

    const feito = [];
    if (plano.daBolsa > 0) {
      const sobra = bolsa - plano.daBolsa;
      if (sobra > 0) {
        await cli.query(
          `UPDATE players SET items = jsonb_set(items, ARRAY[$2::text], to_jsonb($3::bigint))
            WHERE id = $1`,
          [l.id, ID, sobra],
        );
      } else {
        await cli.query(`UPDATE players SET items = items - $2::text WHERE id = $1`, [l.id, ID]);
      }
      feito.push(`${plano.daBolsa} da bolsa`);
    }
    if (plano.desequipar.length) {
      await cli.query(
        `UPDATE player_pokemon SET held_item_id = NULL WHERE id = ANY($1::bigint[])`,
        [plano.desequipar.map((k) => k.id)],
      );
      feito.push(
        `${plano.desequipar.length} equipada(s) [${plano.desequipar.map((k) => `#${k.id} Nv ${k.level}`).join(', ')}]`,
      );
    }

    // O log de gameplay é onde o admin procura depois ("por que eu tinha 3 e agora tenho 2?").
    // Mesma categoria/ação que o sim grava no login, para as duas correções aparecerem juntas.
    await cli.query(
      `INSERT INTO player_gameplay_log (player_id, nick, categoria, acao, detalhe, ref)
       VALUES ($1,$2,'item','xpshare_dup',$3,$4)`,
      [
        l.id, jog.nick,
        `Exp. Share além do comprado (varredura): tinha ${bolsa + segurando.length}, `
        + `direito a ${jog.xp_share_total}. Removida(s) ${plano.excedente} — ${feito.join(' + ')}.`,
        `item:${ID}`,
      ],
    );

    await cli.query('COMMIT');
    return { ok: feito.join(' + '), qtd: plano.excedente };
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    return { erro: err.message };
  } finally {
    cli.release();
  }
}

const corrigiveis = excedentes.filter((l) => !suspeitas.includes(l));
const barradas = excedentes.filter((l) => suspeitas.includes(l));

if (!corrigiveis.length) {
  console.log('\nNada a corrigir.');
} else {
  console.log(`\nCorrigindo ${corrigiveis.length} conta(s) — só quem está fora há ${minOffline}+ min:\n`);
  for (const l of corrigiveis) {
    const r = await removerExcedente(l);
    if (r.ok) console.log(`  OK   ${l.nick}: -${r.qtd} (${r.ok})`);
    else if (r.pulado) console.log(`  --   ${l.nick}: pulado, ${r.pulado}`);
    else console.log(`  ERRO ${l.nick}: ${r.erro}`);
  }
}

if (barradas.length) {
  console.log(
    `\n${barradas.length} conta(s) com excedente NÃO foram tocadas porque xp_share_total não bate`
    + ' com o histórico: aí o suspeito é a coluna, e cortar por ela tiraria item de quem pagou.'
    + ` (${barradas.map((l) => l.nick).join(', ')})`,
  );
}

if (faltantes.length) {
  console.log(
    `\n${totalFaltante} unidade(s) SUMIRAM em ${faltantes.length} conta(s). Devolver é decisão`
    + ' humana (pode ser a mesma falha do outro lado, pode ser conta apagada no meio) — esta'
    + ' ferramenta só reporta.',
  );
}

await pool.end();
