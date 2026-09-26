// A trava de "um anúncio por item" do Mercado da Comunidade, pela função de verdade.
//
// O bug que ela fecha: uma fazenda de contas anunciava a MESMA pedra a 50.000, 49.999,
// 49.998… Cada centavo escapava do empilhamento (que só junta linhas de preço idêntico) e
// virava um anúncio novo no topo da vitrine, até a lista de itens ser de um vendedor só.
//
// Este teste fala com `criarAnuncio` diretamente, e não pela tela: a trava é do banco (a
// transação é quem decide), e o caminho de UI não acrescentaria nada ao que se quer provar.
// Precisa do Postgres de pé — `docker compose up -d`.
//
//   node tools/teste-market-trava.mjs
import { pool } from '../src/server/db.mjs';
import { criarAnuncio, cancelarAnuncio, REANUNCIO_MIN } from '../src/server/market-db.mjs';

// Um id fora do catálogo: nada mais no banco local mexe com ele, então o teste não esbarra
// em anúncio de gente de verdade nem deixa lixo visível se algo estourar no meio.
const ITEM = 999_999;

let ok = 0, falhas = 0;
const conferir = (rotulo, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ok    ${rotulo}`); }
  else { falhas++; console.log(`  FALHA ${rotulo} ${extra}`); }
};

const { rows: [j] } = await pool.query(
  `INSERT INTO players (nick, gold) VALUES ($1, 0) RETURNING id`,
  [`trava-teste-${Date.now()}`],
);
const vendedorId = Number(j.id);
const base = {
  vendedorId, vendedor: 'trava-teste', tipo: 'item',
  itemId: ITEM, qtd: 1, ficha: {}, moeda: 'gold', dias: null,
};

try {
  console.log(`\ntrava de reanúncio — ${REANUNCIO_MIN} min\n`);

  const a1 = await criarAnuncio({ ...base, preco: 50000 });
  conferir('o primeiro anúncio publica', a1?.id > 0);

  // O empilhamento é o caminho honesto e continua aberto: quem achou mais três pedras põe as
  // três na linha que já está lá. Travar isto seria travar o vendedor de verdade.
  const a2 = await criarAnuncio({ ...base, preco: 50000, qtd: 3 });
  conferir('mesmo preço empilha na mesma linha', a2.id === a1.id && a2.qtd === 4, `(id ${a2.id} qtd ${a2.qtd})`);

  let erro = null;
  try { await criarAnuncio({ ...base, preco: 49999 }); } catch (e) { erro = e; }
  conferir('mesmo item por outro preço é recusado', erro?.message === 'market.travaItemAberto', `(${erro?.message})`);

  // Trocar de moeda também escapava do empilhamento, e é a mesma escada com outro nome.
  erro = null;
  try { await criarAnuncio({ ...base, preco: 50000, moeda: 'orb' }); } catch (e) { erro = e; }
  conferir('mesmo item em outra moeda é recusado', erro?.message === 'market.travaItemAberto', `(${erro?.message})`);

  await cancelarAnuncio({ id: a1.id, vendedorId });
  erro = null;
  try { await criarAnuncio({ ...base, preco: 49999 }); } catch (e) { erro = e; }
  conferir('recém saído da vitrine, ainda recusa', erro?.message === 'market.travaItemEspera', `(${erro?.message})`);
  conferir('e diz quantos minutos faltam', erro?.params?.min === REANUNCIO_MIN, `(${JSON.stringify(erro?.params)})`);

  const outro = await criarAnuncio({ ...base, itemId: ITEM + 1, preco: 50000 });
  conferir('outro item do mesmo vendedor segue livre', outro?.id > 0);

  await pool.query(
    `UPDATE market_anuncios SET fechado_em = now() - INTERVAL '31 minutes'
      WHERE vendedor_id = $1 AND item_id = $2`,
    [vendedorId, ITEM],
  );
  const a3 = await criarAnuncio({ ...base, preco: 49999 });
  conferir('passada a espera, publica de novo', a3?.id > 0 && a3.id !== a1.id);
} finally {
  await pool.query(`DELETE FROM market_anuncios WHERE vendedor_id = $1`, [vendedorId]);
  await pool.query(`DELETE FROM players WHERE id = $1`, [vendedorId]);
  await pool.end();
}

console.log(`\n${ok} ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
