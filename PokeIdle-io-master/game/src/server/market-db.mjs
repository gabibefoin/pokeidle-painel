// Mercado Global: anúncios entre jogadores, e o banco que os segura.
//
// ### Por que isto não é write-behind
//
// O resto do jogo grava em lote a cada 5 s e aceita perder 5 segundos num crash. Aqui não
// dá: um anúncio é a única cópia de um pokémon que saiu da mão do dono, e um pagamento é
// dinheiro. Como as ORBs, cada movimento é uma transação que ou fecha inteira ou não
// acontece — e o jogador espera a resposta.
//
// ### O problema que manda no desenho: o flush sobrescreve `gold` e `items`
//
// `flushJogadores` grava `gold`, `items` e os pokémon SUJOS a partir da MEMÓRIA do sim. Ou
// seja: creditar o vendedor direto no banco não funciona. Se ele estiver online, o próximo
// flush dele desfaz o crédito — o UPDATE do sim passa por cima com o valor velho que estava
// em memória. E o vendedor quase sempre está offline ou noutro shard, que é justamente
// quando não há memória nenhuma para mexer.
//
// A saída é uma CAIXA POSTAL (`market_pagamentos`): a compra não credita ninguém, só deixa
// o pagamento anotado. O sim do vendedor recolhe quando ele entra (e de tempos em tempos,
// se já estiver dentro), soma na memória e marca sujo. Aí o flush é aliado em vez de
// inimigo — ele grava exatamente o número que o sim acabou de calcular.
//
// Repare que ORB é o caso fácil e não passa por aqui à toa: `orbs` NÃO está no UPDATE do
// flush (o ledger é a verdade). Mesmo assim o pagamento em ORB entra na mesma caixa postal,
// por uma razão de produto e não técnica: o vendedor tem de ver "você vendeu X por Y" uma
// vez só, com as duas moedas no mesmo lugar.
//
// ### O escrow
//
// Anunciar TIRA da mão. Item sai do `items` em memória; pokémon ganha `anuncio_id` na linha
// e o `carregarPokemons` passa a ignorá-lo. Sem isso o jogador anuncia, vende o mesmo
// pokémon no NPC, e o comprador recebe um id que não existe mais.
//
// ### A CAIXA DE FUNDADOR é o terceiro caso, e é o do pokémon
//
// Ela viaja como `tipo = 'item'` (o `item_id` é o da caixa, e é por ele que a vitrine agrupa
// os anúncios sob "Founder Box"), mas o escrow é o do pokémon: a unidade mora numa linha de
// `caixas_beta` com série própria, e é essa linha que ganha `anuncio_id`. `ficha.caixaId` e
// `ficha.serie` são o que liga as duas pontas.
//
// Daí duas exceções, e as duas estão marcadas onde acontecem: a caixa NÃO empilha com outra do
// mesmo vendedor (a `#01` e a `#02` são mercadorias diferentes), e devolver um anúncio de
// caixa NÃO soma nada em `players.items` — solta o escrow, como se faz com o pokémon.
//
// ### A CASA é o quarto, e é o mesmo da caixa
//
// Também `tipo = 'item'` (a vitrine agrupa pela raridade: "Legendary House"), com a unidade numa
// linha da tabela `casas` — o id dela É o número da casa no servidor. `ficha.casaId` liga as duas
// pontas, e as duas exceções da caixa valem igual: não empilha e não devolve quantidade.
import { pool } from './db.mjs';
import { rotuloSerie } from '../shared/caixas-beta.mjs';
import { numeroDaCasa } from '../shared/casas.mjs';
import { numeroDaBicicleta } from '../shared/bicicletas.mjs';
import { MOTIVO } from './game/orbs.mjs';
import { MOTIVO as MOTIVO_DIA } from './game/diamantes.mjs';
import { movimentarNaTransacao as moverDiamante, saldoVendavelDeDiamantes } from './diamantes-db.mjs';
import { especies } from './content.mjs';
import { OUTLAND_POKE_MIN, OUTLAND_POKE_MAX } from '../shared/outland.mjs';
import {
  IV_MIN, IV_MAX, POTENCIA_MIN, POTENCIA_MAX, QUALIDADE_MIN, QUALIDADE_MAX, FAIXAS_NOTA,
  notaDePokemon, notaMercadoDoPokemon, motivoNaoAnunciavel,
} from '../shared/nota-pokemon.mjs';

/** Converte o filtro de IV mínimo da vitrine (soma dos seis stats). Vazio = sem filtro. */
export function parseIvMinFiltro(v) {
  if (v === '' || v == null) return null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < IV_MIN) return null;
  return Math.min(IV_MAX, n);
}

/** Nível mínimo do pokémon congelado na ficha. Vazio = sem filtro. */
export function parseNivelMinFiltro(v) {
  if (v === '' || v == null) return null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/** Potência mínima 1–5. Vazio = sem filtro. */
export function parsePotenciaMinFiltro(v) {
  if (v === '' || v == null) return null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < POTENCIA_MIN) return null;
  return Math.min(POTENCIA_MAX, n);
}

/**
 * Qualidade mínima 0,8–1,8. Vazio = sem filtro.
 *
 * A VÍRGULA entra aqui também, e não só na tela: o cliente já manda ponto, mas o teclado de um
 * celular em português digita vírgula, e um `Number('1,3')` é `NaN` — que este parse leria como
 * "sem filtro" e devolveria a vitrine inteira, calada, em vez do recorte pedido.
 */
export function parseQualidadeMinFiltro(v) {
  if (v === '' || v == null) return null;
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  if (!Number.isFinite(n) || n < QUALIDADE_MIN) return null;
  return Math.min(QUALIDADE_MAX, Math.round(n * 100) / 100);
}

/**
 * Nota da calculadora, 0–10. Mesma vírgula da qualidade, e três casas, que é a resolução em que
 * a tela mostra a nota ("N 3,643"). Vazio = sem filtro.
 */
export function parseNotaFiltro(v) {
  if (v === '' || v == null) return null;
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(FAIXAS_NOTA.at(-1).ate, Math.round(n * 1000) / 1000);
}

/**
 * As FAIXAS da vitrine de pokémon: cada uma lê um número da ficha congelada e aceita um piso, um
 * teto, ou os dois ("nota de 3,8 a 4,1", "IV acima de 166"). As duas pontas passam pelo mesmo
 * parse, então o teto se comporta como o piso: acima do máximo encosta nele, abaixo do mínimo
 * vira "sem filtro".
 *
 * `col` é SQL nosso — o que vem do jogador só entra como parâmetro. Sem `COALESCE`: ficha que
 * não tem o número não cai em faixa nenhuma (um "IV até 100" não pode trazer o anúncio que não
 * sabe o próprio IV). A exceção é a potência, que antes de existir era P1 — ver `CRITERIOS`.
 */
const FAIXAS = [
  { min: 'nivelMin', max: 'nivelMax', col: `(ficha->>'level')::int`, parse: parseNivelMinFiltro },
  { min: 'potenciaMin', max: 'potenciaMax', col: `COALESCE((ficha->>'potencia')::int, 1)`, parse: parsePotenciaMinFiltro },
  { min: 'ivMin', max: 'ivMax', col: `(ficha->>'ivTotal')::int`, parse: parseIvMinFiltro },
  { min: 'qualidadeMin', max: 'qualidadeMax', col: `(ficha->>'quality')::real`, parse: parseQualidadeMinFiltro },
  { min: 'notaMin', max: 'notaMax', col: `(ficha->>'nota')::real`, parse: parseNotaFiltro },
];

/** Os campos de faixa de um pedido da vitrine — o sim repassa exatamente estes. */
export const CAMPOS_FAIXA = FAIXAS.flatMap((f) => [f.min, f.max]);

/** Comissão sobre anúncio cobrado em ORB. */
export const TAXA_ORB = 0.15;

/** Comissão sobre anúncio cobrado em Coins. */
export const TAXA_GOLD = 0.10;

/** Preço unitário mínimo em ORB — abaixo disto `liquidoDoVendedor` zera (ex.: 1 × 15% = 0). */
export const PRECO_MIN_ORB = Math.ceil(1 / (1 - TAXA_ORB));

/** Preço unitário mínimo em Coins — abaixo disto `liquidoDoVendedor` zera (ex.: 1 × 10% = 0). */
export const PRECO_MIN_GOLD = Math.ceil(1 / (1 - TAXA_GOLD));

/** Quanto o vendedor recebe de fato, já descontada a comissão. */
export const liquidoDoVendedor = (preco, moeda) => {
  if (moeda === 'orb') return Math.floor(preco * (1 - TAXA_ORB));
  if (moeda === 'gold') return Math.floor(preco * (1 - TAXA_GOLD));
  return preco;
};

export function msgPrecoMinOrb() {
  return `preço mínimo em gemas: ${PRECO_MIN_ORB} por unidade (taxa de ${Math.round(TAXA_ORB * 100)}%)`;
}

export function msgPrecoMinGold() {
  return `preço mínimo em Coins: ${PRECO_MIN_GOLD} por unidade (taxa de ${Math.round(TAXA_GOLD * 100)}%)`;
}

/** Teto de anúncios abertos por jogador. Sem ele, um bot enche a lista sozinho. */
export const MAX_ANUNCIOS = 20;

/**
 * UM anúncio aberto por item, e 30 minutos entre um anúncio e o próximo do MESMO item.
 *
 * ### O buraco que isto fecha
 *
 * O empilhamento logo abaixo junta duas Water Stone do mesmo vendedor pelo mesmo preço numa
 * linha só — e a fresta era essa: bastava mudar o preço em UM Coin para escapar dele. Uma
 * fazenda de contas anunciava a mesma pedra a 50.000, 49.999, 49.998… e cada centavo virava
 * uma linha nova no topo da vitrine. Vinte por conta, pelo `MAX_ANUNCIOS`, vezes quantas
 * contas o dono quisesse: a lista de itens vira uma escada de preços de um vendedor só e não
 * sobra espaço para mais ninguém.
 *
 * O teto de 20 nunca deu conta disso porque ele conta anúncios, não REPETIÇÃO. A trava aqui
 * conta a repetição: um item, um anúncio. Quem quer vender mais barato EDITA o preço do que
 * já está de pé (`editarAnuncio`), que é a operação honesta e a que a fresta existia para
 * evitar — o anúncio velho some do topo em vez de acumular.
 *
 * ### Por que a espera existe além do "um por vez"
 *
 * Sem ela, a mesma fazenda derruba o próprio anúncio e publica outro em seguida, e a vitrine
 * — que ordena pelo mais novo — continua sendo dela, um anúncio por vez. Os 30 minutos são o
 * que transforma "spam" em "vender": entre um anúncio e o próximo do mesmo item há meia hora,
 * tenha o anterior sido vendido, cancelado ou devolvido por varredura.
 *
 * Vale para ITEM, não para pokémon: cada bicho é uma peça única (o escrow já impede anunciar
 * o mesmo duas vezes) e a pensão da feira de 100.000 Coins por dia já cobra caro pelo excesso.
 * A Caixa de Fundador fica de fora pela mesma razão do empilhamento — a `#01` e a `#02` são
 * mercadorias diferentes, ainda que compartilhem o `item_id`. A Casa também: a `#000007` e a
 * `#000031` são duas Casas Comuns diferentes.
 */
export const REANUNCIO_MS = 30 * 60 * 1000;
export const REANUNCIO_MIN = REANUNCIO_MS / 60_000;

/**
 * A pensão da feira: 100.000 Coins por DIA, paga à vista — e só para POKÉMON.
 *
 * Item fica na prateleira e prateleira não come. Pokémon anunciado é um bicho vivo entregue
 * aos tratadores da feira, que o alimentam e cuidam dele até alguém levar — e isso tem
 * custo. A diária é essa pensão, e é o que impede a feira de virar depósito de bicho parado
 * a dez vezes o preço: quem pede muito, paga por pedir muito.
 *
 * Sempre em COINS, mesmo no anúncio cobrado em gema: gema tem lastro e é o ativo escasso, e
 * cobrar pensão nela empurraria o vendedor a não usar a moeda que o mercado quer.
 *
 * Sem reembolso ao vender antes do prazo — os tratadores cuidaram dos dias que cuidaram.
 * Devolver dia proporcional convidaria ao ciclo "publica caro, cancela, republica" para
 * ocupar o topo da lista de graça.
 *
 * `dias = null` (todo anúncio de ITEM) grava `expira_em` NULL e não paga nada.
 *
 * Os 50.000 originais vinham da economia velha, em que um jogador de late game fazia isso em
 * meio abate e um de nível 100 levava oito. Com o ouro travado no nível 100 a renda por abate
 * ficou quase plana (ver `shared/economia-drop.mjs`), então a diária foi re-ancorada em 15.000.
 *
 * E 15.000 ficou BARATO. Uma diária de dois a três abates não é freio nenhum: segurar um bicho
 * trinta dias a dez vezes o preço saía por 450.000, trocado para quem já anuncia — e a feira
 * voltou a encher de anúncio caro e parado, que é exatamente o que a pensão existe para evitar.
 * Agora são 100.000 por dia: ~152 abates no nível 100 e ~5,5 no topo (`alvoRendaPorKill`), e o
 * mês inteiro custa 3.000.000. Quem pede muito paga por pedir muito.
 */
export const TAXA_DIARIA = 100_000;
export const DIAS_MIN = 1;
export const DIAS_MAX = 30;

/**
 * Tempo em que o anúncio fica visível mas ainda não pode ser comprado: 2 minutos.
 *
 * Histórico de 15/09/2026, para ninguém refazer o caminho: subiu para 8 horas o dia todo (v1.93.0),
 * virou 5 minutos de dia e 8 horas de madrugada (v1.96.0) e voltou a 2 minutos no mesmo dia
 * (v1.97.0). A retenção longa travava o comércio honesto e a comunidade não quis. Contra o bot que
 * compra no milissegundo da liberação quem trabalha é o sorteio dos primeiros 3 s
 * (`sorteio-mercado.mjs`), que não depende do tamanho da retenção.
 *
 * Quem decide é o banco: `compravel_em` nasce `now() + isto` dentro da transação do anúncio e é
 * relido com `now()` no `FOR UPDATE` da compra — o relógio do cliente não entra na conta.
 * Cancelar continua valendo durante a retenção (o item volta para quem anunciou).
 */
export const COOLDOWN_COMPRA_MS = 2 * 60 * 1000;
export const COOLDOWN_COMPRA_MIN = COOLDOWN_COMPRA_MS / 60_000;

export const custoDoAnuncio = (dias) => TAXA_DIARIA * limitarDias(dias);

export function limitarDias(dias) {
  const n = Math.floor(Number(dias));
  if (!Number.isFinite(n)) return DIAS_MIN;
  return Math.max(DIAS_MIN, Math.min(DIAS_MAX, n));
}

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_anuncios (
      id           BIGSERIAL PRIMARY KEY,
      vendedor_id  BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      vendedor     TEXT   NOT NULL,        -- nick desnormalizado: a lista mostra e não vale um join
      tipo         TEXT   NOT NULL,        -- 'item' | 'pokemon' | 'diamante'
      item_id      INT,                    -- tipo='item'
      qtd          INT    NOT NULL DEFAULT 1,
      pokemon_id   BIGINT REFERENCES player_pokemon(id) ON DELETE CASCADE,
      -- Retrato do que está à venda, congelado no momento do anúncio. É o que a lista
      -- desenha sem tocar em player_pokemon nem no catálogo de itens.
      ficha        JSONB  NOT NULL DEFAULT '{}'::jsonb,
      preco        BIGINT NOT NULL,        -- por UNIDADE, sempre
      moeda        TEXT   NOT NULL,        -- 'gold' | 'orb'
      estado       TEXT   NOT NULL DEFAULT 'aberto', -- aberto | vendido | cancelado
      criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
      fechado_em   TIMESTAMPTZ,
      comprador_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
      comprador    TEXT
    )`);
  // A consulta da vitrine é sempre "abertos, mais novos primeiro"; o índice parcial cobre
  // exatamente isso e não carrega o histórico de vendido/cancelado, que só cresce.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mkt_abertos ON market_anuncios(criado_em DESC) WHERE estado = 'aberto'`,
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mkt_vendedor ON market_anuncios(vendedor_id, id DESC)`);

  // A caixa postal. Append-only até ser recolhida; `recolhido_em` é o único UPDATE.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_pagamentos (
      id           BIGSERIAL PRIMARY KEY,
      anuncio_id   BIGINT NOT NULL REFERENCES market_anuncios(id) ON DELETE CASCADE,
      vendedor_id  BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      moeda        TEXT   NOT NULL,
      valor        BIGINT NOT NULL,        -- já LÍQUIDO, com a comissão descontada
      bruto        BIGINT NOT NULL,        -- o que o comprador pagou, para o extrato
      descricao    TEXT   NOT NULL,        -- "3× Water Stone", "Charizard Nv 87"
      comprador_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
      comprador    TEXT,                   -- nick do comprador desta fatia (parcial pode ter vários)
      criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
      recolhido_em TIMESTAMPTZ
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mkt_pag_pendente ON market_pagamentos(vendedor_id) WHERE recolhido_em IS NULL`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mkt_pag_hist ON market_pagamentos(vendedor_id, criado_em DESC)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mkt_pag_compras ON market_pagamentos(comprador_id, criado_em DESC)
      WHERE comprador_id IS NOT NULL`,
  );
  // A TABELA DE PREÇOS pública (`historicoGlobal`): "as N vendas mais recentes do servidor
  // inteiro", sem filtro de jogador. Os dois índices acima começam por `vendedor_id` /
  // `comprador_id` e não servem a uma varredura que não tem nenhum dos dois — sem este, a
  // consulta viraria um seq scan da tabela toda a cada abertura do painel.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mkt_pag_global ON market_pagamentos(criado_em DESC, id DESC)`,
  );
  await pool.query(`ALTER TABLE market_pagamentos ADD COLUMN IF NOT EXISTS comprador_id BIGINT`);
  await pool.query(`ALTER TABLE market_pagamentos ADD COLUMN IF NOT EXISTS comprador TEXT`);

  // O escrow do pokémon. NULL = está com o dono; preenchido = está na vitrine e o
  // `carregarPokemons` do sim não o enxerga mais.
  await pool.query(
    `ALTER TABLE player_pokemon ADD COLUMN IF NOT EXISTS anuncio_id BIGINT`,
  );

  // Aluguel da vitrine. `expira_em` NULL nos anúncios anteriores à taxa: eles ficam abertos
  // até serem vendidos ou cancelados, porque cobrar retroativo de quem publicou sob outra
  // regra seria mudar o contrato no meio. A varredura só olha quem tem data.
  await pool.query(`ALTER TABLE market_anuncios ADD COLUMN IF NOT EXISTS expira_em TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE market_anuncios ADD COLUMN IF NOT EXISTS dias INT`);
  await pool.query(`ALTER TABLE market_anuncios ADD COLUMN IF NOT EXISTS taxa_paga BIGINT NOT NULL DEFAULT 0`);
  await pool.query(
    `ALTER TABLE market_anuncios ADD COLUMN IF NOT EXISTS compravel_em TIMESTAMPTZ`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mkt_expira ON market_anuncios(expira_em)
      WHERE estado = 'aberto' AND expira_em IS NOT NULL`,
  );
  // A caixa postal das DEVOLUÇÕES DO SERVIDOR (ver `fecharParaDevolucao`): o anúncio fechado por
  // vencimento ou por regra cuja mercadoria ainda não chegou à memória do dono. Nasce `false` em
  // toda linha antiga, e só esta versão a liga — um sim da versão anterior, no meio de um deploy,
  // fecha e devolve do jeito dele sem ligá-la, e por isso nada é entregue duas vezes.
  await pool.query(
    `ALTER TABLE market_anuncios ADD COLUMN IF NOT EXISTS devolucao_pendente BOOLEAN NOT NULL DEFAULT false`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mkt_devolucao ON market_anuncios(vendedor_id) WHERE devolucao_pendente`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mkt_item_stack ON market_anuncios(vendedor_id, item_id, preco, moeda)
      WHERE estado = 'aberto' AND tipo = 'item'`,
  );
  // A trava de reanúncio (ver `REANUNCIO_MS`) pergunta "o que este vendedor fez com ESTE item",
  // e a resposta está no fim do histórico dele. Sem este índice a pergunta varre todos os
  // anúncios que ele já publicou na vida — e é justamente o vendedor grande, com milhares de
  // linhas, quem mais publica.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mkt_reanuncio ON market_anuncios(vendedor_id, item_id, fechado_em DESC)
      WHERE tipo = 'item'`,
  );
}

/** O id da Caixa de Fundador presa a um anúncio, ou `null` se ele não é de caixa. */
const caixaDoAnuncio = (r) => {
  const id = Number(r?.ficha?.caixaId);
  return Number.isFinite(id) && id > 0 ? id : null;
};

/** O número da Casa presa a um anúncio, ou `null` se ele não é de casa. */
const casaDoAnuncio = (r) => {
  const id = Number(r?.ficha?.casaId);
  return Number.isFinite(id) && id > 0 ? id : null;
};

/** O número da Bicicleta presa a um anúncio, ou `null` se ele não é de bicicleta. */
const bicicletaDoAnuncio = (r) => {
  const id = Number(r?.ficha?.bicicletaId);
  return Number.isFinite(id) && id > 0 ? id : null;
};

/**
 * Solta o escrow das peças numeradas — caixas e casas — de um lote de anúncios devolvidos.
 *
 * Existe porque as quatro varreduras de devolução (expiração, curadoria, preço inválido em
 * gema e em Coins) somavam a mercadoria em `players.items` — o que, para uma caixa ou uma casa,
 * criaria um item fantasma e deixaria a linha real presa a um anúncio morto para sempre.
 */
async function soltarCaixasDeAnuncios(cli, linhas) {
  const caixas = linhas.map(caixaDoAnuncio).filter(Boolean);
  if (caixas.length) {
    await cli.query(`UPDATE caixas_beta SET anuncio_id = NULL WHERE id = ANY($1::bigint[])`, [caixas]);
  }
  const casas = linhas.map(casaDoAnuncio).filter(Boolean);
  if (casas.length) {
    await cli.query(`UPDATE casas SET anuncio_id = NULL WHERE id = ANY($1::bigint[])`, [casas]);
  }
  const bicicletas = linhas.map(bicicletaDoAnuncio).filter(Boolean);
  if (bicicletas.length) {
    await cli.query(`UPDATE bicicletas SET anuncio_id = NULL WHERE id = ANY($1::bigint[])`, [bicicletas]);
  }
}

/**
 * Devolve ao vendedor os diamantes presos num lote de anúncios que estão sendo fechados.
 *
 * Existe pelo mesmo motivo de `soltarCaixasDeAnuncios`: são QUATRO caminhos de devolução
 * (cancelamento, expiração, preço inválido em gema e em Coins) e a devolução tem de acontecer
 * em todos. Um anúncio de diamante fechado sem passar por aqui é confisco — o escrow saiu do
 * ledger na criação e não voltaria nunca.
 *
 * `qtd` é a quantidade ATUAL da linha, não a original: numa compra parcial o comprador já
 * levou a fatia dele (e já foi creditado), e o que resta em escrow é exatamente o que sobrou.
 *
 * Roda dentro da transação de quem chamou — a devolução e o fechamento do anúncio são um fato
 * só, como o escrow e a criação foram.
 */
async function devolverDiamantesDeAnuncios(cli, linhas) {
  for (const r of linhas) {
    if (r.tipo !== 'diamante') continue;
    const qtd = Math.floor(Number(r.qtd) || 0);
    if (qtd <= 0) continue;
    await moverDiamante(
      cli, Number(r.vendedor_id), qtd, MOTIVO_DIA.MERCADO_DEVOLUCAO, `anuncio:${r.id}`,
      `${qtd} diamante(s) de volta do Mercado da Comunidade`,
    );
  }
}

/**
 * Erro que o cliente vai TRADUZIR: a `message` é uma chave de i18n e `params` são os buracos
 * dela. Os avisos antigos do mercado viajam como frase pronta em português — aqui não dá,
 * porque a espera tem um número dentro e quem lê pode estar jogando em inglês ou espanhol.
 */
function erroTraduzivel(chave, params = null) {
  const err = new Error(chave);
  err.params = params;
  return err;
}

/**
 * A trava de "um anúncio por item" e a espera de 30 minutos. Ver `REANUNCIO_MS`.
 *
 * As duas perguntas saem numa consulta só, e as duas datas são do RELÓGIO DO BANCO: comparar
 * `fechado_em` com o `Date.now()` do Node deixaria a espera valer 29 ou 31 minutos conforme a
 * deriva do relógio da máquina — e é o número que vai na tela do jogador.
 *
 * `GREATEST(0, …)` cobre o caso sem histórico: `max()` de nenhuma linha é NULL, e GREATEST
 * ignora NULL e devolve o zero.
 *
 * O `ficha->>'caixaId' IS NULL` deixa a Caixa de Fundador de fora: ela divide o `item_id` com
 * as outras caixas do mesmo tipo, mas cada linha é uma peça numerada — anunciar a `#02` não
 * pode esbarrar na `#01`.
 */
async function conferirTravaDeItem(cli, { vendedorId, itemId }) {
  const { rows } = await cli.query(
    `SELECT
       count(*) FILTER (WHERE estado = 'aberto')::int AS abertos,
       GREATEST(0, CEIL(EXTRACT(EPOCH FROM (
         max(fechado_em) + ($3::int * INTERVAL '1 millisecond') - now()
       )) / 60))::int AS espera_min
       FROM market_anuncios
      WHERE vendedor_id = $1 AND tipo = 'item' AND item_id = $2
        AND ficha->>'caixaId' IS NULL
        AND ficha->>'casaId' IS NULL AND ficha->>'bicicletaId' IS NULL
        AND (estado = 'aberto' OR fechado_em > now() - ($3::int * INTERVAL '1 millisecond'))`,
    [vendedorId, itemId, REANUNCIO_MS],
  );
  const r = rows[0];
  if (r.abertos > 0) throw erroTraduzivel('market.travaItemAberto');
  if (r.espera_min > 0) throw erroTraduzivel('market.travaItemEspera', { min: r.espera_min });
}

/**
 * A mesma trava, para o anúncio de DIAMANTES: um aberto por vez, e 30 min entre um e o próximo.
 *
 * Diamante não tem `item_id` para agrupar, então a chave é o próprio `tipo`. A razão de a trava
 * existir é a mesma do item — sem ela, uma conta abriria vinte anúncios de 1 diamante com um
 * Coin de diferença entre eles e a aba de Diamantes viraria a escada de preços de um vendedor
 * só (ver `REANUNCIO_MS`). E é ainda mais fácil aqui: diamante é fungível, então NÃO existe
 * nem o argumento do "são peças diferentes" que a Caixa de Fundador tem.
 *
 * Quem quiser vender mais barato EDITA o preço do anúncio que já está de pé — a operação
 * honesta, e a que a fresta existia para evitar.
 */
async function conferirTravaDeDiamante(cli, vendedorId) {
  const { rows } = await cli.query(
    `SELECT
       count(*) FILTER (WHERE estado = 'aberto')::int AS abertos,
       GREATEST(0, CEIL(EXTRACT(EPOCH FROM (
         max(fechado_em) + ($2::int * INTERVAL '1 millisecond') - now()
       )) / 60))::int AS espera_min
       FROM market_anuncios
      WHERE vendedor_id = $1 AND tipo = 'diamante'
        AND (estado = 'aberto' OR fechado_em > now() - ($2::int * INTERVAL '1 millisecond'))`,
    [vendedorId, REANUNCIO_MS],
  );
  const r = rows[0];
  if (r.abertos > 0) throw erroTraduzivel('market.travaDiamanteAberto');
  if (r.espera_min > 0) throw erroTraduzivel('market.travaDiamanteEspera', { min: r.espera_min });
}

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

/** Completa snapshot congelado com dados imutáveis do `player_pokemon` (captura, TMs…). */
function completarFichaPokemon(fichaBruta, r) {
  const f = typeof fichaBruta === 'string' ? JSON.parse(fichaBruta) : { ...(fichaBruta ?? {}) };
  if (!f || typeof f !== 'object') return f;
  if (r.pokemon_id != null && r.pk_caught_at != null && f.caughtAt == null) {
    f.caughtAt = r.pk_caught_at.getTime();
  }
  if (r.pk_tm_elemental) f.tmElemental = r.pk_tm_elemental;
  if (r.pk_tm_aoe != null) f.tmAoe = !!r.pk_tm_aoe;
  return f;
}

const JOIN_PK_EXTRA = `pp.caught_at AS pk_caught_at, pp.tm_elemental AS pk_tm_elemental, pp.tm_aoe AS pk_tm_aoe`;

const linhaParaCliente = (r) => {
  const ficha = completarFichaPokemon(r.ficha, r);
  return {
  id: Number(r.id),
  expiraEm: r.expira_em?.getTime?.() ?? null,
  dias: r.dias == null ? null : Number(r.dias),
  vendedor: r.vendedor,
  vendedorId: Number(r.vendedor_id),
  tipo: r.tipo,
  itemId: r.item_id == null ? null : Number(r.item_id),
  pokemonId: r.pokemon_id == null ? null : Number(r.pokemon_id),
  qtd: Number(r.qtd),
  ficha,
  preco: Number(r.preco),
  moeda: r.moeda,
  estado: r.estado,
  criadoEm: r.criado_em?.getTime?.() ?? null,
  compravelEm: r.compravel_em?.getTime?.() ?? null,
  comprador: r.comprador ?? null,
};
};

// ------------------------------------------------------------------ criar

/**
 * O guarda de fronteira do banco: quantidade e preço são INTEIROS POSITIVOS, ponto.
 *
 * O sim já valida os dois antes de chegar aqui, e esta função existe para o dia em que ele
 * deixar de validar — um caminho novo, um refactor, um segundo chamador. A régua vale porque
 * os dois números viram aritmética de dinheiro logo adiante:
 *
 *   · `qtd` NEGATIVO em anúncio de DIAMANTE vira `movimentar(-qtd)` com delta POSITIVO — ou
 *     seja, diamante criado do nada. E a conta ainda ficava INVISÍVEL para uma auditoria
 *     ingênua: a linha do anúncio guarda -50 e o jogador ganha +50, então "carteira + escrow"
 *     continua fechando. Só ao cancelar (que pula quantidade <= 0) o lucro aparece.
 *   · `preco` negativo vira pagamento negativo na caixa postal do vendedor, e depois um
 *     crédito negativo — que `somarGoldAuditado` felizmente descarta, mas não é nele que se
 *     deve confiar para uma linha que nunca deveria ter sido gravada.
 *
 * `Number.isSafeInteger` e não `isInteger`: acima de 2^53 a aritmética de ponto flutuante
 * deixa de ser exata, e um `preco * qtd` nessa faixa mente sobre o próprio resultado.
 */
function conferirNumerosDoAnuncio({ qtd, preco }) {
  if (!Number.isSafeInteger(qtd) || qtd < 1) {
    throw new Error(`quantidade inválida no anúncio: ${qtd}`);
  }
  if (!Number.isSafeInteger(preco) || preco < 1) {
    throw new Error(`preço inválido no anúncio: ${preco}`);
  }
}

/** As duas únicas moedas do Mercado. Fora delas, os mínimos de preço não se aplicariam. */
const MOEDAS_MERCADO = new Set(['gold', 'orb']);

/**
 * Abre um anúncio.
 *
 * O escrow do ITEM não acontece aqui — quem tira do inventário é o sim, em memória, porque
 * é lá que o inventário mora. Esta função só se encarrega do pokémon (que mora no banco) e
 * da linha do anúncio. O sim chama na ordem "reserva na memória → grava aqui", e devolve o
 * item se este INSERT estourar.
 *
 * Item sem pensão da feira: se o vendedor já tem o MESMO item, no MESMO preço unitário e na
 * MESMA moeda, soma a quantidade numa linha só em vez de abrir outra — menos linhas na vitrine
 * e no banco, e o estoque fica num lugar só para compra parcial.
 *
 * E se for o mesmo item por OUTRO preço, não abre nada: é um anúncio por item, com 30 minutos
 * de espera entre um e o próximo (ver `REANUNCIO_MS`).
 *
 * `caixaId` é a Caixa de Fundador que este anúncio carrega. Quando ele vem, o anúncio continua
 * sendo de `tipo = 'item'` mas ganha o escrow do pokémon (a linha de `caixas_beta` passa a
 * apontar para o anúncio) e NÃO empilha — ver o cabeçalho do arquivo.
 *
 * `casaId` é o mesmo desvio para a Casa: a linha de `casas` ganha `anuncio_id`, e o anúncio sai
 * sozinho, sem empilhar e sem a trava de reanúncio do item.
 */
export function criarAnuncio({ vendedorId, vendedor, tipo, itemId, qtd, pokemonId, ficha, preco, moeda, dias = null, caixaId = null, casaId = null, bicicletaId = null }) {
  // Item não tem prazo: `null` vira `expira_em` NULL no INSERT (porque `NULL * INTERVAL`
  // é NULL), e a varredura de expiração só olha quem tem data.
  const prazo = dias == null ? null : limitarDias(dias);
  return comTransacao(async (cli) => {
    // Antes de qualquer coisa: os dois números que viram dinheiro adiante. Ver o guarda.
    conferirNumerosDoAnuncio({ qtd: Number(qtd), preco: Number(preco) });
    if (!MOEDAS_MERCADO.has(moeda)) throw new Error(`moeda inválida no anúncio: ${moeda}`);
    if (moeda === 'orb' && preco < PRECO_MIN_ORB) throw new Error(msgPrecoMinOrb());
    if (moeda === 'gold' && preco < PRECO_MIN_GOLD) throw new Error(msgPrecoMinGold());

    // Uma publicação por vendedor de cada vez. As duas contagens que vêm abaixo — o teto de
    // `MAX_ANUNCIOS` e a trava de reanúncio — leem o estado e decidem em cima do que leram, e
    // duas transações simultâneas do MESMO vendedor leriam as duas o mesmo "zero anúncios
    // deste item" e inseririam as duas. É o buraco por onde uma fazenda de contas passaria de
    // novo, agora com dois sockets em vez de duas contas. O lock é por vendedor (não por
    // tabela) e sai sozinho no COMMIT; ninguém mais no mercado o pede, então não há ordem de
    // aquisição para deadlock. Mesmo desenho do lock de série das caixas.
    await cli.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`market_anuncio:${vendedorId}`]);

    // A caixa não empilha: `#01` e `#02` são peças diferentes, e somá-las numa linha de "2×
    // Founder Box" apagaria o número, que é justamente o que se está vendendo.
    if (tipo === 'item' && !caixaId && !casaId && !bicicletaId) {
      const { rows: pilha } = await cli.query(
        `SELECT * FROM market_anuncios
          WHERE vendedor_id = $1 AND estado = 'aberto' AND tipo = 'item'
            AND item_id = $2 AND preco = $3 AND moeda = $4
          FOR UPDATE`,
        [vendedorId, itemId, preco, moeda],
      );
      if (pilha.length) {
        const atual = pilha[0];
        const novaQtd = Number(atual.qtd) + Number(qtd);
        const { rows } = await cli.query(
          // Somar na pilha REINICIA a retenção do anúncio inteiro. Sem isto, anunciar 1, esperar
          // liberar e depois somar 100 deixava as 100 compráveis na hora — a transferência entre
          // contas que a retenção existe para segurar.
          `UPDATE market_anuncios SET qtd = $2,
                  compravel_em = GREATEST(COALESCE(compravel_em, now()), now() + ($3::int * INTERVAL '1 millisecond'))
            WHERE id = $1 RETURNING *`,
          [atual.id, novaQtd, COOLDOWN_COMPRA_MS],
        );
        return linhaParaCliente(rows[0]);
      }
    }

    // DEPOIS do empilhamento, de propósito: somar quantidade num anúncio que já existe não
    // cria linha nova na vitrine, que é o que esta trava está protegendo. Quem tem 10 Water
    // Stone na prateleira e acha mais 5 continua podendo pôr as 5 lá, pelo mesmo preço.
    if (tipo === 'item' && !caixaId && !casaId && !bicicletaId) {
      await conferirTravaDeItem(cli, { vendedorId, itemId });
    }

    // ------------------------------------------------------- DIAMANTES
    //
    // A cota é lida AQUI DENTRO, com o `pg_advisory_xact_lock` do vendedor já na mão (ele é
    // tomado no topo desta transação). Sem o lock, dois anúncios simultâneos leriam os mesmos
    // "500 vendáveis" e escrowariam 1000 — e o saldo sozinho não pegaria o caso de quem tem
    // 1000 no bolso com só 500 de cota, que é exatamente o buraco que a cota existe para
    // fechar. Ver `saldoVendavelDeDiamantes`.
    if (tipo === 'diamante') {
      await conferirTravaDeDiamante(cli, vendedorId);
      const cota = await saldoVendavelDeDiamantes(cli, vendedorId);
      if (qtd > cota.vendavel) {
        throw erroTraduzivel('market.diamanteSemCota', { tem: cota.vendavel, pediu: qtd });
      }
    }

    const { rows: abertos } = await cli.query(
      `SELECT count(*)::int AS n FROM market_anuncios WHERE vendedor_id = $1 AND estado = 'aberto'`,
      [vendedorId],
    );
    if (abertos[0].n >= MAX_ANUNCIOS) throw new Error(`limite de ${MAX_ANUNCIOS} anúncios abertos`);

    const { rows } = await cli.query(
      `INSERT INTO market_anuncios
         (vendedor_id, vendedor, tipo, item_id, qtd, pokemon_id, ficha, preco, moeda,
          dias, taxa_paga, expira_em, compravel_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + ($10::int * INTERVAL '1 day'),
               now() + ($12::int * INTERVAL '1 millisecond'))
       RETURNING *`,
      [vendedorId, vendedor, tipo, itemId ?? null, qtd, pokemonId ?? null, ficha ?? {}, preco, moeda,
        prazo, prazo == null ? 0 : custoDoAnuncio(prazo), COOLDOWN_COMPRA_MS],
    );
    const anuncio = rows[0];

    if (tipo === 'pokemon') {
      const { rows: dono } = await cli.query(
        `SELECT starter FROM player_pokemon
          WHERE id = $1 AND player_id = $2 AND anuncio_id IS NULL`,
        [pokemonId, vendedorId],
      );
      if (!dono.length) throw new Error('esse pokémon não está mais disponível');
      if (dono[0].starter) throw new Error('o pokémon inicial não pode ser anunciado no mercado');

      // O `anuncio_id IS NULL` é a trava: se o pokémon já está noutro anúncio (dois cliques,
      // duas abas), o UPDATE não acha linha e a transação inteira volta atrás.
      //
      // `held_item_id IS NULL` é a segunda, e é aqui embaixo de propósito. A trava de cima, no
      // sim, lê a MEMÓRIA — e memória e linha podem discordar por até um ciclo de flush. Foi
      // essa fresta que transformou uma Exp. Share em duas: desequipar (memória limpa, linha
      // ainda com o item) e anunciar em seguida passava pela trava de lá e punha em escrow uma
      // linha que ainda segurava o item, enquanto a unidade voltava para a bolsa. Quem grava
      // manda: um pokémon cuja LINHA segura item não vira mercadoria, ponto.
      const upd = await cli.query(
        `UPDATE player_pokemon SET anuncio_id = $1, slot = NULL
          WHERE id = $2 AND player_id = $3 AND anuncio_id IS NULL AND held_item_id IS NULL`,
        [anuncio.id, pokemonId, vendedorId],
      );
      if (!upd.rowCount) throw new Error('esse pokémon não está mais disponível');
    }

    if (caixaId) {
      // Mesma trava do pokémon, e pela mesma razão: `anuncio_id IS NULL` no WHERE impede que
      // dois cliques (ou duas abas) ponham a MESMA caixa em dois anúncios. `aberta_em IS NULL`
      // é a segunda: caixa aberta não é mais mercadoria, e a tela pode estar velha.
      const upd = await cli.query(
        `UPDATE caixas_beta SET anuncio_id = $1
          WHERE id = $2 AND dono_id = $3 AND anuncio_id IS NULL AND aberta_em IS NULL`,
        [anuncio.id, caixaId, vendedorId],
      );
      if (!upd.rowCount) throw new Error('caixas.semCaixa');
    }

    if (casaId) {
      // A trava da caixa, na casa: `dono_id` diz que é dele AGORA (a memória do sim pode estar um
      // passo atrás de uma venda), e `anuncio_id IS NULL` impede a mesma casa em dois anúncios.
      const upd = await cli.query(
        `UPDATE casas SET anuncio_id = $1
          WHERE id = $2 AND dono_id = $3 AND anuncio_id IS NULL`,
        [anuncio.id, casaId, vendedorId],
      );
      if (!upd.rowCount) throw new Error('casa.naoDisponivel');
    }

    if (bicicletaId) {
      // A mesma trava da casa: `dono_id` diz que é dele AGORA, e `anuncio_id IS NULL` impede a mesma
      // bicicleta em dois anúncios (dois cliques, duas abas).
      const upd = await cli.query(
        `UPDATE bicicletas SET anuncio_id = $1
          WHERE id = $2 AND dono_id = $3 AND anuncio_id IS NULL`,
        [anuncio.id, bicicletaId, vendedorId],
      );
      if (!upd.rowCount) throw new Error('bicicleta.naoDisponivel');
    }

    // O ESCROW DO DIAMANTE, e ele mora aqui e não no sim — ao contrário do item.
    //
    // O inventário (`items`, `balls`) é do SIM: ele vive em memória e o flush o grava, então
    // quem tira de lá tem de ser o sim. Diamante é o oposto: saiu do `flushJogadores` de
    // propósito (ver `diamantes-db.mjs`) e a verdade dele é o ledger. Por isso o débito cabe
    // dentro desta transação — e é o que torna "anúncio criado" e "diamante saiu do bolso" um
    // fato só. Um processo que caia no meio não deixa nem anúncio sem lastro nem diamante
    // preso a anúncio nenhum.
    //
    // O `WHERE diamonds + delta >= 0` de `movimentar` é a última trava: por mais que a cota
    // acima diga que pode, ninguém sai daqui com saldo negativo.
    let saldoDiamantes = null;
    if (tipo === 'diamante') {
      saldoDiamantes = await moverDiamante(
        cli, vendedorId, -qtd, MOTIVO_DIA.MERCADO_ESCROW, `anuncio:${anuncio.id}`,
        `${qtd} diamante(s) anunciado(s) no Mercado da Comunidade`,
      );
    }

    // `saldoDiamantes` volta junto para o sim atualizar o cache da tela sem uma segunda
    // consulta — o número já está em mão, e é o mesmo que o ledger acabou de gravar.
    return { ...linhaParaCliente(anuncio), saldoDiamantes };
  });
}

// --------------------------------------------------------------- cancelar

/**
 * Cancela um anúncio e diz ao sim o que devolver.
 *
 * O pokémon volta aqui mesmo (a linha é do banco); o item volta na memória do sim, que lê
 * o retorno. O `estado = 'aberto'` no WHERE é o que impede cancelar algo já vendido.
 */
export function cancelarAnuncio({ id, vendedorId }) {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `UPDATE market_anuncios SET estado = 'cancelado', fechado_em = now()
        WHERE id = $1 AND vendedor_id = $2 AND estado = 'aberto'
        RETURNING *`,
      [id, vendedorId],
    );
    if (!rows.length) throw new Error('anúncio não está aberto');
    const a = rows[0];

    if (a.tipo === 'pokemon') {
      await cli.query(`UPDATE player_pokemon SET anuncio_id = NULL WHERE id = $1`, [a.pokemon_id]);
    }
    // A caixa volta para a mão do vendedor soltando o escrow — nada é somado em `items`.
    await soltarCaixasDeAnuncios(cli, [a]);
    // O diamante volta pelo ledger, na mesma transação que fecha o anúncio.
    await devolverDiamantesDeAnuncios(cli, [a]);
    return linhaParaCliente(a);
  });
}

// ---------------------------------------------------------------- comprar

/**
 * Fecha uma compra — inteira ou PARCIAL.
 *
 * O que acontece aqui dentro, tudo numa transação:
 *   1. trava o anúncio (`FOR UPDATE`) e confere que ainda está aberto e tem quantidade;
 *   2. em ORB, debita o comprador pelo ledger — com lastro em USDT, o débito vem primeiro;
 *   3. transfere o pokémon, se for pokémon;
 *   4. baixa a quantidade (ou fecha o anúncio, se levou tudo);
 *   5. deixa o pagamento na caixa postal do vendedor.
 *
 * ### Por que a compra parcial mora aqui e não numa "reserva"
 *
 * Anunciar 100 Water Stone e obrigar o comprador a levar as 100 é o mesmo que não ter mercado
 * de item nenhum — ninguém tem ouro para o lote inteiro, e o vendedor acaba abrindo 100
 * anúncios de 1. Então `qtd` do anúncio é ESTOQUE, e cada compra tira uma fatia dele.
 *
 * A trava é o `FOR UPDATE` da linha do anúncio: duas compras simultâneas do mesmo estoque
 * viram fila, e a segunda lê a quantidade já baixada pela primeira. É por isso que o pedido é
 * conferido AQUI DENTRO e não na leitura otimista que o sim faz antes.
 *
 * Pedir mais do que resta é ERRO, e não "leva o que tem": o jogador escolheu 10 vendo 10 na
 * tela, e entregar 3 calado cobrando por 3 é decidir por ele. O erro traz o número que sobrou
 * para a tela poder se corrigir.
 *
 * O que NÃO acontece aqui: creditar o vendedor e entregar o item ao comprador. Os dois vivem
 * na memória do sim (`gold`, `items`) e seriam desfeitos pelo flush — o sim faz a sua parte
 * lendo o retorno.
 *
 * O ouro do COMPRADOR também é debitado pelo sim, em memória, ANTES de chamar aqui: ele
 * está necessariamente online (acabou de clicar) e o flush dele é quem grava. Se esta
 * transação estourar, o sim devolve.
 */
export function comprarAnuncio({ id, compradorId, comprador, qtd, preco, moeda }) {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `SELECT *,
              (compravel_em IS NOT NULL AND compravel_em > now()) AS retido
         FROM market_anuncios WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const a = rows[0];
    if (!a) throw new Error('anúncio não existe');
    if (a.estado !== 'aberto') throw new Error('esse anúncio já saiu');
    if (Number(a.vendedor_id) === compradorId) throw new Error('não dá para comprar o próprio anúncio');
    // `now()` do Postgres — mesma referência que `editarAnuncio` e o INSERT usam; evita TOCTOU
    // entre relógio JS e o banco no limiar dos 2 minutos, com a linha já travada.
    if (a.retido) {
      throw new Error('este anúncio ainda está em retenção — ele libera quando o contador zerar');
    }

    // ---------------------------------------------------- a trava de preço
    //
    // O comprador declara o preço UNITÁRIO e a moeda que ele viu na vitrine, e a transação
    // recusa se os termos pioraram. Sem isto existia um golpe de manual, do tipo
    // *time-of-check / time-of-use*:
    //
    //   1. o vendedor anuncia um pokémon por 1 gema;
    //   2. o comprador vê "1 gema" na tela e clica em comprar;
    //   3. antes de a mensagem chegar, o vendedor edita o anúncio para 20.000 gemas;
    //   4. a transação lia o preço ATUAL e debitava as 20.000.
    //
    // O `FOR UPDATE` acima nunca protegeu contra isso: ele serializa as duas escritas, mas a
    // edição pode acontecer inteirinha ANTES da compra chegar, e aí não há corrida nenhuma —
    // só um preço diferente do que foi mostrado. A defesa tem de ser o preço COMBINADO.
    //
    // A `moeda` entra na trava pelo mesmo motivo: `editarAnuncio` troca as duas, e um anúncio
    // de 100 de ouro que vira 100 gemas cobra o mesmo número numa moeda que vale muito mais.
    //
    // Preço que CAIU é aceito e cobrado pelo novo valor: o comprador concordou em pagar até
    // aquilo, e pagar menos não pode prejudicá-lo. Só o que piora é recusado.
    const precoVisto = Number(preco);
    if (!Number.isFinite(precoVisto) || precoVisto < 0) {
      // Fecha por baixo de propósito: um cliente que não manda o preço é um cliente velho (ou
      // adulterado), e no primeiro caso um F5 resolve. Aceitar sem trava reabriria o golpe.
      throw new Error('recarregue a página para comprar (versão antiga do jogo)');
    }
    if (moeda !== a.moeda) throw new Error('a moeda deste anúncio mudou — confira antes de comprar');
    if (Number(a.preco) > precoVisto) {
      throw new Error('o preço deste anúncio subiu — confira antes de comprar');
    }

    const estoque = Number(a.qtd);
    // Pokémon é peça única: `qtd` é sempre 1 e não há fatia que faça sentido pedir.
    //
    // AUSENTE e ZERO são coisas diferentes. Ausente (`0` de omissão, `undefined`, `null`) é
    // "leva o lote", que é o contrato de antes da compra parcial existir e o que um cliente
    // velho manda. Zero DIGITADO é pedido inválido e tem de doer — um `|| estoque` inocente
    // aqui transformava "comprar 0" em "comprar as 100", que é a compra errada mais cara
    // possível de se fazer por engano.
    const omitido = qtd === undefined || qtd === null || qtd === '';
    const pedido = a.tipo === 'pokemon' ? 1 : omitido ? estoque : Math.floor(Number(qtd));
    if (!Number.isFinite(pedido) || pedido < 1) throw new Error('quantidade inválida');
    if (pedido > estoque) throw new Error(`só restam ${estoque}`);

    const total = Number(a.preco) * pedido;
    const liquido = liquidoDoVendedor(total, a.moeda);
    const sobra = estoque - pedido;

    if (a.moeda === 'orb') {
      const { rows: deb } = await cli.query(
        `UPDATE players SET orbs = orbs - $2 WHERE id = $1 AND orbs - $2 >= 0 RETURNING orbs`,
        [compradorId, total],
      );
      if (!deb.length) throw new Error('Gemas insuficientes');
      await cli.query(
        `INSERT INTO orb_ledger (player_id, delta, saldo_apos, motivo, ref, nota)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [compradorId, -total, Number(deb[0].orbs), MOTIVO.MARKET_COMPRA, `anuncio:${id}`, a.vendedor],
      );
    }

    if (a.tipo === 'pokemon') {
      const upd = await cli.query(
        `UPDATE player_pokemon SET player_id = $1, slot = NULL, anuncio_id = NULL
          WHERE id = $2 AND anuncio_id = $3`,
        [compradorId, a.pokemon_id, id],
      );
      if (!upd.rowCount) throw new Error('o pokémon deste anúncio sumiu');
    }

    // O DIAMANTE também é entregue aqui dentro, e pela mesma razão do escrow na criação: ele
    // não passa pelo `flushJogadores`, então o ledger é o lugar certo — e assim "o anúncio
    // baixou" e "o comprador recebeu" viram um fato só. O item e o pokémon não podem fazer
    // isso (moram na memória do sim), e é por isso que os dois voltam pelo retorno da função.
    //
    // `pedido` e não `a.qtd`: a compra parcial leva uma fatia, e o resto continua em escrow do
    // vendedor até alguém levar ou ele cancelar.
    //
    // O crédito vai com `MERCADO_COMPRA`, que NÃO conta para a cota de venda: quem comprou
    // diamante de outro jogador não pagou por ele em dinheiro de verdade, e revender fecharia
    // um ciclo em que a cota do servidor deixaria de ser limitada pelo que entrou. Ver
    // `MOTIVOS_DA_COTA_DE_VENDA` em `game/diamantes.mjs`.
    let diamantesDoComprador = null;
    if (a.tipo === 'diamante') {
      diamantesDoComprador = await moverDiamante(
        cli, compradorId, pedido, MOTIVO_DIA.MERCADO_COMPRA, `anuncio:${id}`,
        `${pedido} diamante(s) comprado(s) de ${a.vendedor}`,
      );
    }

    // A CAIXA troca de dono aqui dentro, como o pokémon: o número vai junto, e é ele que o
    // comprador está levando. `aberta_em IS NULL` continua no WHERE porque uma caixa aberta
    // não pode mudar de mão — os prêmios dela já se prenderam a uma conta.
    const caixaId = caixaDoAnuncio(a);
    if (caixaId) {
      const upd = await cli.query(
        `UPDATE caixas_beta SET dono_id = $1, anuncio_id = NULL
          WHERE id = $2 AND anuncio_id = $3 AND aberta_em IS NULL`,
        [compradorId, caixaId, id],
      );
      if (!upd.rowCount) throw new Error('caixas.anuncioSumiu');
    }

    // A CASA muda de dono como a caixa, com o número junto — e VAZIA: os postos de XP Share são
    // do jogador (`players.xp_share`), não da linha, e o do vendedor já saiu no anúncio.
    const casaId = casaDoAnuncio(a);
    if (casaId) {
      const upd = await cli.query(
        `UPDATE casas SET dono_id = $1, anuncio_id = NULL WHERE id = $2 AND anuncio_id = $3`,
        [compradorId, casaId, id],
      );
      if (!upd.rowCount) throw new Error('casa.anuncioSumiu');
    }

    // A BICICLETA muda de dono como a casa, com o número junto. Chega desequipada: a equipada do
    // comprador é um número dele, e a do vendedor deixa de existir na mão de quem vendeu.
    const bicicletaId = bicicletaDoAnuncio(a);
    if (bicicletaId) {
      const upd = await cli.query(
        `UPDATE bicicletas SET dono_id = $1, anuncio_id = NULL WHERE id = $2 AND anuncio_id = $3`,
        [compradorId, bicicletaId, id],
      );
      if (!upd.rowCount) throw new Error('bicicleta.anuncioSumiu');
    }

    // Sobrou estoque: o anúncio CONTINUA aberto, só mais magro. `comprador` fica em branco de
    // propósito — a coluna guarda quem fechou o anúncio, e num lote com dez compradores
    // qualquer nome ali seria mentira. Quem comprou o quê está na caixa postal, um recibo por
    // compra, que é o extrato que o vendedor lê.
    if (sobra > 0) {
      await cli.query(`UPDATE market_anuncios SET qtd = $2 WHERE id = $1`, [id, sobra]);
    } else {
      await cli.query(
        `UPDATE market_anuncios SET estado = 'vendido', fechado_em = now(), comprador_id = $2, comprador = $3
          WHERE id = $1`,
        [id, compradorId, comprador],
      );
    }

    // A caixa é peça única e o NÚMERO é o produto: um recibo de "1× Founder Box" não diz ao
    // vendedor qual das caixas dele saiu.
    const descricao =
      a.tipo === 'pokemon'
        ? `${a.ficha?.nome ?? 'Pokémon'} Nv ${a.ficha?.level ?? '?'}`
        : a.tipo === 'diamante'
          ? `${pedido}× 💎`
          : caixaId
            ? `${a.ficha?.nome ?? 'Box'} ${rotuloSerie(a.ficha?.caixaTipo, a.ficha?.serie)}`
            : casaId
              ? `${a.ficha?.nome ?? 'House'} ${numeroDaCasa(casaId)}`
              : bicicletaId
                ? `${a.ficha?.nome ?? 'Bicycle'} ${numeroDaBicicleta(bicicletaId)}`
                : `${pedido}× ${a.ficha?.nome ?? `item ${a.item_id}`}`;

    await cli.query(
      `INSERT INTO market_pagamentos (anuncio_id, vendedor_id, moeda, valor, bruto, descricao, comprador_id, comprador)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, a.vendedor_id, a.moeda, liquido, total, descricao, compradorId, comprador],
    );

    // `anuncio.qtd` sai com o PEDIDO, não com o estoque de antes: é o que o sim entrega ao
    // comprador. Quanto restou vai à parte, em `sobra`.
    return {
      anuncio: { ...linhaParaCliente(a), qtd: pedido },
      total, liquido, sobra,
      // O saldo de diamante do COMPRADOR depois do crédito, para o sim atualizar o cache da
      // tela sem uma segunda consulta. `null` em qualquer outro tipo de anúncio.
      diamantesDoComprador,
    };
  });
}

// -------------------------------------------------------------- consultas

/**
 * Como a vitrine pode ser ordenada — e por que são DUAS listas e não uma.
 *
 * ### O problema da lista única
 *
 * Havia um só "Ordenar por", com dezesseis opções misturando duas naturezas: coisas do
 * MERCADO (preço, recência) e coisas do POKÉMON (IV, nota, qualidade, potência, refino). Como
 * o `<select>` escolhe UMA, as duas perguntas que o jogador de verdade faz eram impossíveis:
 *
 *     "o de melhor nota que esteja mais barato"
 *     "P5 primeiro, e entre os P5 o de IV mais alto, e entre esses o mais barato"
 *
 * Escolher "nota" dava a lista por nota com preços aleatórios; escolher "barato" dava a lista
 * por preço com notas aleatórias. Não havia como pedir as duas, porque as duas não competiam
 * pelo mesmo lugar: uma é o CRITÉRIO e a outra é o DESEMPATE.
 *
 * ### O desenho
 *
 * `CRITERIOS` são os atributos do pokémon, escolhidos em conjunto e NA ORDEM em que o jogador
 * os ligou — é essa ordem que vira a prioridade. `ORDENS` é o eixo do mercado, e entra por
 * último, desempatando o que os critérios deixaram igual. O `ORDER BY` final é a concatenação:
 *
 *     critérios: [potencia, iv]   ordem: baratos
 *     → ORDER BY potencia DESC, ivTotal DESC, preco ASC, id DESC
 *
 * E é aí que o empate deixa de ser detalhe e vira o produto: `potencia` tem cinco valores e
 * `ivTotal` é inteiro, então há centenas de linhas empatadas em cada degrau — o `preco ASC`
 * no fim é o que de fato ordena o que o jogador vê.
 *
 * ### Por que os critérios não terminam em `id DESC`
 *
 * As entradas de `CRITERIOS` são só a EXPRESSÃO, sem desempate próprio, porque elas nunca são
 * a última coluna do `ORDER BY` — quem fecha a lista é sempre uma de `ORDENS`, e todas elas
 * já terminam em `id DESC`. Um desempate no meio da lista mataria os critérios seguintes: com
 * `id DESC` depois de `potencia`, nenhuma linha empata mais e o `ivTotal` nunca seria lido.
 *
 * ### O que continua valendo
 *
 * O preço ordena pelo UNITÁRIO, que é o número comparável desde que a compra passou a ser por
 * fatia: quem quer 10 Water Stone escolhe entre pagar 200 ou 240 por pedra, e o tamanho do
 * lote de quem anunciou não entra nessa conta. (Enquanto o comprador era obrigado a levar o
 * lote inteiro fazia sentido ordenar por `preco * qtd`; não faz mais.)
 *
 * Nível, potência e IV vêm da FICHA, congelada no anúncio, e não de um join com
 * `player_pokemon`: a linha de lá pode até ter mudado de dono no meio, e o que está à venda é
 * o retrato. `COALESCE(…, 1)` cobre os anúncios abertos antes de a potência existir.
 *
 * O `id DESC` no fim de toda `ORDENS` é o desempate final: sem ele, duas linhas de mesmo preço
 * podem trocar de lugar entre uma página e outra e um anúncio some da lista sem nunca ter sido
 * visto.
 */

/** Critério por um IV isolado dentro de `ficha.ivs` (anúncios antigos sem ivs caem em 0). */
const criterioIvStat = (stat) => `COALESCE((ficha->'ivs'->>'${stat}')::int, 0) DESC`;

/**
 * Os critérios de POKÉMON, combináveis. A chave é o que o cliente manda; o valor é SQL nosso,
 * nunca texto do jogador — `criteriosValidos` recusa qualquer chave que não esteja aqui.
 */
const CRITERIOS = {
  nivel: `COALESCE((ficha->>'level')::int, 0) DESC`,
  potencia: `COALESCE((ficha->>'potencia')::int, 1) DESC`,
  qualidade: `COALESCE((ficha->>'quality')::real, 0) DESC`,
  iv: `COALESCE((ficha->>'ivTotal')::int, 0) DESC`,
  ivHp: criterioIvStat('hp'),
  ivAtk: criterioIvStat('atk'),
  ivDef: criterioIvStat('def'),
  ivSpAtk: criterioIvStat('spAtk'),
  ivSpDef: criterioIvStat('spDef'),
  ivSpd: criterioIvStat('speed'),
  nota: `COALESCE((ficha->>'nota')::real, 0) DESC`,
  // O `+N` do refino, somando os cinco stats. Lê `refinoTotal` da ficha, que o sim já grava
  // pronto (`totalDoRefino`), em vez de somar `ficha->'refino'` aqui — a soma em SQL exigiria
  // um `jsonb_each` por linha, e o número já vem calculado do outro lado.
  //
  // Anúncio aberto ANTES do refino existir não tem a chave e cai em 0, que é a verdade: aquele
  // bicho não tinha refino nenhum. Nada a migrar.
  refino: `COALESCE((ficha->>'refinoTotal')::int, 0) DESC`,
};

/** Quantos critérios cabem num pedido. Seis é mais fundo que qualquer lista real. */
export const MAX_CRITERIOS = 6;

/** Os eixos do MERCADO. Um só, sempre o último do `ORDER BY`, e todos fecham em `id DESC`. */
const ORDENS = {
  recentes: 'criado_em DESC, id DESC',
  baratos: 'preco ASC, id DESC',
  caros: 'preco DESC, id DESC',
};

/**
 * As chaves de critério válidas de um pedido, sem repetição e no limite.
 *
 * A deduplicação não é capricho: `potencia DESC, potencia DESC` é SQL válido e silenciosamente
 * inútil, e um cliente adulterado podia mandar a mesma chave `MAX_CRITERIOS` vezes para gastar
 * planejamento do Postgres de graça.
 */
export function criteriosValidos(lista) {
  if (!Array.isArray(lista)) return [];
  const vistos = new Set();
  for (const bruto of lista) {
    const k = String(bruto ?? '');
    // `Object.hasOwn` e NÃO `CRITERIOS[k]`: `CRITERIOS` é um objeto literal, então herda de
    // `Object.prototype` e `CRITERIOS['constructor']` (ou `toString`, `valueOf`,
    // `hasOwnProperty`…) devolve uma FUNÇÃO — que é truthy. O whitelist deixava essas chaves
    // passarem e `ordenarPor` interpolava "function Object() { [native code] }" no ORDER BY.
    //
    // Hoje isso só produz erro de sintaxe no Postgres (o texto vem do protótipo, não do
    // atacante, e não carrega aspas), mas um whitelist que não filtra é a metade de uma
    // injeção — falta só alguém poluir `Object.prototype` com uma string em outro canto.
    if (Object.hasOwn(CRITERIOS, k) && !vistos.has(k)) vistos.add(k);
    if (vistos.size >= MAX_CRITERIOS) break;
  }
  return [...vistos];
}

/**
 * A tradução dos clientes VELHOS, e é por isso que ela existe.
 *
 * Até esta versão o `ordem` carregava as duas naturezas juntas, então uma aba aberta desde
 * antes do deploy manda `ordem: 'nivel'` — que não está mais em `ORDENS` e cairia no padrão
 * "recentes", trocando a lista debaixo de quem não pediu nada. Aqui `'nivel'` volta a ser o
 * que sempre foi: o CRITÉRIO nível, com o mercado desempatando por recência.
 *
 * Não é migração de banco nem código de compatibilidade eterno: é a mesma cortesia da barra de
 * "versão nova, recarregue", para a janela em que as duas versões convivem.
 */
export function normalizarOrdenacao({ ordem = '', criterios = null } = {}) {
  const chave = String(ordem ?? '');
  const escolhidos = criteriosValidos(criterios);
  // `hasOwn` nos dois, pela mesma razão de `criteriosValidos` logo acima.
  if (Object.hasOwn(ORDENS, chave)) return { ordem: chave, criterios: escolhidos };
  // `padrao` era o nome antigo de "recentes" na aba de pokémon; segue caindo no mesmo lugar.
  if (Object.hasOwn(CRITERIOS, chave)) return { ordem: 'recentes', criterios: criteriosValidos([chave, ...escolhidos]) };
  return { ordem: 'recentes', criterios: escolhidos };
}

/** O `ORDER BY` inteiro: os critérios do pokémon e, fechando, o eixo do mercado. */
const ordenarPor = (ordem, criterios) =>
  [
    // `criterios` já veio de `criteriosValidos`, mas esta é a linha que VIRA SQL: ela filtra
    // de novo em vez de confiar em quem chamou. Uma chave desconhecida some da lista em vez
    // de entrar como `undefined` no `join`.
    ...criterios.filter((k) => Object.hasOwn(CRITERIOS, k)).map((k) => CRITERIOS[k]),
    Object.hasOwn(ORDENS, ordem) ? ORDENS[ordem] : ORDENS.recentes,
  ].join(', ');

/**
 * A vitrine. Filtros e ordenação da tela, com paginação.
 *
 * `busca` casa contra o NOME congelado na ficha — o mesmo texto que a lista desenha. Casar
 * contra o catálogo de itens daria resultado que o jogador não vê.
 *
 * `speciesIds` e `itemIds` chegam prontos do sim, que é quem tem o catálogo em memória para
 * saber o que é "de fogo" (ver `market.listar`). Uma lista VAZIA não é o mesmo que ausente:
 * significa "o filtro não casa com nada" e tem de devolver zero linhas, não a vitrine inteira
 * — por isso o teste é `Array.isArray` e não a verdade do valor.
 */
export async function listar({
  tipo = '', moeda = '', busca = '', ordem = '', criterios = null, soShiny = false, soP5 = false,
  soTmElemental = false, soTmAoe = false, semOutland = false,
  speciesIds = null, itemIds = null, pagina = 0, porPagina = 24,
  // O piso e o teto de cada faixa (`nivelMin`, `notaMax`…) — ver `FAIXAS`.
  ...faixas
} = {}) {
  // As duas listas de ordenação, saneadas juntas: só daqui saem chaves que existem, e é aqui
  // que o `ordem` de um cliente velho volta a ser um critério. Ver `normalizarOrdenacao`.
  const orden = normalizarOrdenacao({ ordem, criterios });
  const cond = [`estado = 'aberto'`];
  const args = [];
  if (tipo === 'item' || tipo === 'pokemon' || tipo === 'diamante') cond.push(`tipo = $${args.push(tipo)}`);
  if (moeda === 'gold' || moeda === 'orb') cond.push(`moeda = $${args.push(moeda)}`);
  if (busca.trim()) cond.push(`ficha->>'nome' ILIKE $${args.push(`%${busca.trim()}%`)}`);
  if (soShiny) cond.push(`ficha->>'shiny' = 'true'`);
  if (soP5) cond.push(`COALESCE((ficha->>'potencia')::int, 0) = 5`);
  // "Omitir Pokémon de Outland": as variantes (#2001–#2058, ver `shared/outland.mjs`) saem da
  // vitrine. É o filtro de quem busca "pupitar" querendo o Pupitar de verdade, e não o Ancient
  // Pupitar — o nome de um contém o do outro, e a busca por texto casa os dois. Os limites são
  // constantes nossas interpoladas como NÚMERO, nunca texto do cliente.
  if (semOutland) {
    cond.push(`COALESCE((ficha->>'speciesId')::int, -1) NOT BETWEEN ${Number(OUTLAND_POKE_MIN)} AND ${Number(OUTLAND_POKE_MAX) - 1}`);
  }
  if (soTmElemental) {
    cond.push(`(
      NULLIF(ficha->>'tmElemental', '') IS NOT NULL
      OR EXISTS (SELECT 1 FROM player_pokemon pp WHERE pp.id = pokemon_id AND pp.tm_elemental IS NOT NULL)
    )`);
  }
  if (soTmAoe) {
    cond.push(`(
      ficha->>'tmAoe' = 'true'
      OR EXISTS (SELECT 1 FROM player_pokemon pp WHERE pp.id = pokemon_id AND pp.tm_aoe = true)
    )`);
  }
  for (const f of FAIXAS) {
    let piso = f.parse(faixas[f.min]);
    let teto = f.parse(faixas[f.max]);
    // Digitada ao contrário ("de 4,1 até 3,8") é a mesma faixa, e não uma vitrine vazia.
    if (piso != null && teto != null && piso > teto) [piso, teto] = [teto, piso];
    if (piso != null) cond.push(`${f.col} >= $${args.push(piso)}`);
    if (teto != null) cond.push(`${f.col} <= $${args.push(teto)}`);
  }
  if (Array.isArray(speciesIds)) {
    cond.push(`COALESCE((ficha->>'speciesId')::int, -1) = ANY($${args.push(speciesIds)}::int[])`);
  }
  if (Array.isArray(itemIds)) cond.push(`item_id = ANY($${args.push(itemIds)}::int[])`);

  const onde = cond.join(' AND ');
  const { rows: cont } = await pool.query(`SELECT count(*)::int AS n FROM market_anuncios WHERE ${onde}`, args);
  const { rows } = await pool.query(
    `SELECT ma.*, ${JOIN_PK_EXTRA}
       FROM market_anuncios ma
       LEFT JOIN player_pokemon pp ON pp.id = ma.pokemon_id
      WHERE ${onde} ORDER BY ${ordenarPor(orden.ordem, orden.criterios)}
      LIMIT $${args.push(porPagina)} OFFSET $${args.push(pagina * porPagina)}`,
    args,
  );
  // `ordem` e `criterios` voltam SANEADOS: é assim que a tela de um cliente velho (que mandou
  // `ordem: 'nivel'`) descobre que aquilo virou um critério, e desenha os dois seletores no
  // estado em que a lista de fato veio, em vez de mostrar um filtro que o servidor ignorou.
  return {
    total: cont[0].n, pagina, porPagina,
    ordem: orden.ordem, criterios: orden.criterios,
    linhas: rows.map(linhaParaCliente),
  };
}

// ------------------------------------------------- vitrine de itens em lista
//
// A aba de itens não pagina mais anúncio a anúncio: ela desenha o CATÁLOGO (toda pedra,
// todo TM, toda ficha de boss) e, ao clicar, abre os anúncios daquele item. São duas
// leituras diferentes e é por isso que são duas funções.

/**
 * Quantos anúncios e qual o menor preço unitário de cada item, por moeda.
 *
 * Devolve só o que TEM anúncio. O catálogo inteiro está no cliente (`CATALOGO_MERCADO`),
 * então o que faltar aqui é exatamente o que a tela escreve como "sem anunciantes" — o que
 * evita mandar 39 linhas de zeros a cada abertura do modal.
 */
export async function resumoItens(itemIds) {
  if (!Array.isArray(itemIds) || !itemIds.length) return {};
  const { rows } = await pool.query(
    `SELECT item_id,
            count(*)::int                            AS anuncios,
            COALESCE(sum(qtd), 0)::bigint            AS unidades,
            min(preco) FILTER (WHERE moeda = 'gold') AS min_gold,
            min(preco) FILTER (WHERE moeda = 'orb')  AS min_orb
       FROM market_anuncios
      WHERE estado = 'aberto' AND tipo = 'item' AND item_id = ANY($1::int[])
      GROUP BY item_id`,
    [itemIds],
  );
  return Object.fromEntries(rows.map((r) => [Number(r.item_id), {
    anuncios: r.anuncios,
    unidades: Number(r.unidades),
    minGold: r.min_gold == null ? null : Number(r.min_gold),
    minOrb: r.min_orb == null ? null : Number(r.min_orb),
  }]));
}

/**
 * Os anúncios abertos de UM item numa moeda, do mais barato para o mais caro.
 *
 * É a lista do painel: quem vende, quantas unidades e por quanto cada uma. Sem paginação
 * de propósito — o teto de 60 cobre com folga o item mais disputado, e rolagem infinita
 * numa lista já ordenada por preço só afastaria a linha que interessa, que é a primeira.
 */
export async function anunciosDoItem(itemId, moeda, { limite = 60 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM market_anuncios
      WHERE estado = 'aberto' AND tipo = 'item' AND item_id = $1 AND moeda = $2
      ORDER BY preco ASC, id ASC LIMIT $3`,
    [itemId, moeda === 'orb' ? 'orb' : 'gold', limite],
  );
  return rows.map(linhaParaCliente);
}

/**
 * Cancela os anúncios de item que a curadoria nova não aceita mais e devolve a mercadoria.
 *
 * Roda no BOOT de cada sim — e, com o restart um sim de cada vez, os outros já têm gente
 * conectada. Por isso o item não é somado em `players.items` aqui (o flush de quem está
 * on-line apagaria a soma): ele sai pela caixa postal de `fecharParaDevolucao`, e o sim do
 * dono entrega.
 *
 * Tudo numa transação: ou o anúncio fecha COM a devolução pendente, ou nada muda. Um
 * cancelamento sem devolução seria confisco.
 */
export function devolverAnunciosProibidos(permitidos) {
  if (!Array.isArray(permitidos) || !permitidos.length) return Promise.resolve([]);
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `SELECT id, vendedor_id, vendedor, tipo, item_id, qtd, ficha FROM market_anuncios
        WHERE estado = 'aberto' AND tipo = 'item' AND NOT (item_id = ANY($1::int[]))
        ORDER BY id FOR UPDATE`,
      [permitidos],
    );
    if (!rows.length) return [];
    await fecharParaDevolucao(cli, rows, 'cancelado');

    return rows.map((r) => ({
      id: Number(r.id), vendedor: r.vendedor, vendedorId: Number(r.vendedor_id),
      itemId: Number(r.item_id), qtd: Number(r.qtd), nome: r.ficha?.nome ?? `#${r.item_id}`,
    }));
  });
}

/**
 * Devolve ao Depot todo pokémon anunciado ANTES da pensão da feira existir.
 *
 * ### Por que isto precisa acontecer
 *
 * A pensão (`TAXA_DIARIA`) mudou o contrato no meio: quem anunciou sob a regra antiga pôs o
 * bicho na vitrine de graça e por prazo indeterminado, e ficaria ocupando a feira para sempre
 * sem pagar o que todo anúncio novo paga. Pior, seriam justamente os anúncios velhos — os
 * caros e parados, que a diária existe para desencorajar — os únicos isentos dela.
 *
 * Cobrar retroativo não é opção (o jogador não escolheu esse preço), então a saída é desfazer:
 * o pokémon volta ao dono e quem ainda quiser vender reanuncia pagando, como todo mundo.
 *
 * ### O critério se fecha sozinho
 *
 * `dias IS NULL` marca exatamente os anúncios legados: desde a v1.18.0 todo anúncio de pokémon
 * passa por `limitarDias()`, que nunca devolve `null` (ver o `market.anunciar` do sim). Então
 * esta função pode rodar em TODO boot sem risco — depois da primeira passagem não sobra linha
 * para ela achar, e um anúncio novo jamais se qualifica. É o que dispensa uma flag de "já
 * migrou", que é o tipo de estado que alguém esquece de limpar.
 *
 * ### Onde o pokémon cai
 *
 * No Depot, não na equipe. `criarAnuncio` zera o `slot` ao pôr em escrow, e aqui só se solta o
 * `anuncio_id` — sem slot, o bicho é do Depot, que é o lugar certo: devolver direto para a
 * equipe empurraria para fora quem está lá lutando agora.
 *
 * Roda no BOOT de cada sim, pelo caminho da irmã acima: o pokémon volta no banco, e a caixa
 * postal (`fecharParaDevolucao`) é o que o põe na memória do dono que já está jogando noutro
 * sim — sem ela, ele só apareceria no Depot depois do relog.
 */
export function devolverPokemonSemPensao() {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `SELECT id, vendedor_id, vendedor, tipo, pokemon_id, ficha, preco, moeda
         FROM market_anuncios
        WHERE estado = 'aberto' AND tipo = 'pokemon' AND dias IS NULL
        ORDER BY id FOR UPDATE`,
    );
    if (!rows.length) return [];
    await fecharParaDevolucao(cli, rows, 'cancelado');

    return rows.map((r) => ({
      id: Number(r.id),
      vendedor: r.vendedor,
      vendedorId: Number(r.vendedor_id),
      pokemonId: Number(r.pokemon_id),
      nome: r.ficha?.nome ?? `#${r.pokemon_id}`,
      nivel: r.ficha?.level ?? null,
      preco: Number(r.preco),
      moeda: r.moeda,
    }));
  });
}

/**
 * Cancela anúncios de pokémon que não passam mais na faixa mínima (nível + nota) e devolve
 * o bicho ao dono, dentro da COLEÇÃO.
 *
 * Roda no BOOT depois de `backfillNotaAnuncios` (em `db.migrar`): a nota congelada na ficha
 * é recalculada com a fórmula nova, e quem ficar abaixo do mínimo volta ao dono — mesmo
 * critério de `motivoNaoAnunciavel` (shiny e P5 ficam na vitrine).
 *
 * Mesma regra das outras devoluções de boot: fecha por `fecharParaDevolucao`, e o sim do dono
 * põe o pokémon de volta na memória.
 *
 * A diferença é o DESTINO. As outras devoluções largam o pokémon no Depot, que é de onde ele
 * saiu; esta não, porque aqui quem desfez o anúncio foi o servidor, mudando a regra debaixo de
 * um anúncio que era válido quando foi publicado. No Depot solto o bicho entra na varredura da
 * venda ao NPC, e o jogador que estava de férias voltaria sem ele. O destino viaja na própria
 * FICHA (`paraColecao`), e não numa segunda tabela: a ficha já é reescrita aqui por causa da
 * nota recalculada, ela sai inteira em `recolherDevolucoes`, e assim a intenção sobrevive ao
 * jogador ficar semanas offline com a devolução parada na caixa postal.
 */
export function devolverPokemonAbaixoDoMinimo() {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `SELECT id, vendedor_id, vendedor, tipo, pokemon_id, ficha, preco, moeda
         FROM market_anuncios
        WHERE estado = 'aberto' AND tipo = 'pokemon'
        ORDER BY id FOR UPDATE`,
    );
    if (!rows.length) return [];

    const barrados = [];
    for (const r of rows) {
      const ficha = typeof r.ficha === 'string' ? JSON.parse(r.ficha) : { ...(r.ficha ?? {}) };
      const nota = notaMercadoDoPokemon(ficha, especies);
      if (nota != null) ficha.nota = nota;
      const pk = { ...ficha, level: ficha.level, nota };
      const motivo = motivoNaoAnunciavel(pk, especies);
      if (!motivo) continue;
      ficha.paraColecao = true;
      barrados.push({ ...r, ficha, motivo });
    }
    if (!barrados.length) return [];

    for (const r of barrados) {
      await cli.query(
        `UPDATE market_anuncios SET ficha = $1::jsonb WHERE id = $2`,
        [JSON.stringify(r.ficha), r.id],
      );
    }
    await fecharParaDevolucao(cli, barrados, 'cancelado');

    return barrados.map((r) => ({
      id: Number(r.id),
      vendedor: r.vendedor,
      vendedorId: Number(r.vendedor_id),
      pokemonId: Number(r.pokemon_id),
      nome: r.ficha?.nome ?? `#${r.pokemon_id}`,
      nivel: r.ficha?.level ?? null,
      nota: r.ficha?.nota ?? null,
      motivo: r.motivo,
      preco: Number(r.preco),
      moeda: r.moeda,
    }));
  });
}

/**
 * Fecha os anúncios cujo aluguel acabou e solta o que mora no banco.
 *
 * O POKÉMON, as peças numeradas e o diamante voltam aqui mesmo: basta soltar o escrow (e o
 * ledger, no diamante). O ITEM não — o inventário de quem está on-line está na memória de um
 * sim, e escrever no banco por baixo seria desfeito no flush seguinte. E mesmo o que voltou no
 * banco ainda tem de chegar à MEMÓRIA do dono, senão o pokémon só reaparece no próximo login.
 *
 * Quem roda esta varredura é o primeiro sim a chegar nela, e ele fecha os vencidos do servidor
 * INTEIRO — o dono, em geral, está noutro shard. Por isso a entrega não acontece aqui: o
 * anúncio fica com `devolucao_pendente`, e quem entrega é o sim que tem o dono em memória
 * (`recolherDevolucoes`) — o mesmo desenho da caixa postal de pagamentos.
 *
 * Sem reembolso da taxa — o prazo contratado foi cumprido.
 */
export function expirarAnuncios() {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `SELECT id, vendedor_id, vendedor, tipo, item_id, qtd, pokemon_id, ficha
         FROM market_anuncios
        WHERE estado = 'aberto' AND expira_em IS NOT NULL AND expira_em <= now()
        ORDER BY id FOR UPDATE`,
    );
    if (!rows.length) return [];
    await fecharParaDevolucao(cli, rows, 'expirado');
    return rows.map(devolucaoDaLinha);
  });
}

/**
 * Fecha um lote de anúncios que o SERVIDOR devolve — vencimento, curadoria, preço abaixo do
 * mínimo, legado sem pensão — e solta tudo o que mora no banco.
 *
 * O pokémon, as peças numeradas e o diamante voltam aqui mesmo. O item não: ele vai para a
 * memória do dono por `recolherDevolucoes`, e a bandeira `devolucao_pendente` é o recibo disso.
 * Nenhum destes caminhos escreve em `players.items`/`balls`, porque não há como saber daqui se
 * o dono está carregado em algum sim — e, se estiver, o flush dele apagaria o crédito.
 *
 * O cancelamento pelo próprio dono (`cancelarAnuncio`) fica de fora: ele acontece no sim que já
 * tem o dono em memória, e a devolução sai ali mesmo.
 *
 * Roda dentro da transação de quem chamou, com as linhas já presas por `FOR UPDATE` e ainda
 * `aberto` — é o que garante que um anúncio só é fechado (e devolvido) uma vez.
 */
async function fecharParaDevolucao(cli, linhas, estado) {
  await cli.query(
    `UPDATE market_anuncios SET estado = $2, fechado_em = now(), devolucao_pendente = true
      WHERE id = ANY($1::bigint[])`,
    [linhas.map((r) => r.id), estado],
  );
  // Solta o escrow. O `slot` já está NULL desde o anúncio — é isso que põe o bicho no Depot, e
  // não na equipe, onde empurraria para fora quem está lutando.
  const pokemons = linhas
    .filter((r) => r.tipo === 'pokemon')
    .map((r) => Number(r.pokemon_id))
    .filter(Number.isFinite);
  if (pokemons.length) {
    await cli.query(`UPDATE player_pokemon SET anuncio_id = NULL WHERE id = ANY($1::bigint[])`, [pokemons]);
  }
  await soltarCaixasDeAnuncios(cli, linhas);
  await devolverDiamantesDeAnuncios(cli, linhas);
}

/** Uma linha de anúncio fechado no formato que o sim entrega ao dono. */
const devolucaoDaLinha = (r) => ({
  id: Number(r.id), vendedorId: Number(r.vendedor_id), vendedor: r.vendedor,
  tipo: r.tipo,
  // `expirado` (o prazo acabou) ou `cancelado` (o servidor fechou por regra) — muda só o aviso.
  estado: r.estado ?? null,
  itemId: r.item_id == null ? null : Number(r.item_id),
  pokemonId: r.pokemon_id == null ? null : Number(r.pokemon_id),
  // Anúncio de caixa não devolve QUANTIDADE nenhuma — o escrow já pôs a peça de volta na mão
  // do dono. Quem lê esta lista tem de pular o crédito em `items`.
  caixaId: caixaDoAnuncio(r),
  // A casa, idem: o escrow já voltou, e quem lê só precisa reler as casas do dono.
  casaId: casaDoAnuncio(r),
  bicicletaId: bicicletaDoAnuncio(r),
  // O pokémon que o servidor tirou da vitrine por não passar mais na faixa mínima volta para a
  // COLEÇÃO do dono, e não para o Depot solto (ver `devolverPokemonAbaixoDoMinimo`). A marca
  // vem da ficha porque é ela que atravessa a caixa postal.
  paraColecao: r.ficha?.paraColecao === true,
  // Beast Ball volta para `balls`, não para `items` (o id colide com o Band Aid).
  ballId: r.ficha?.bola ? Number(r.ficha.ballId ?? r.item_id) : null,
  qtd: Number(r.qtd), nome: r.ficha?.nome ?? '', level: r.ficha?.level ?? null,
});

/**
 * Recolhe as devoluções pendentes de um vendedor — a caixa postal de `fecharParaDevolucao`.
 *
 * Desliga a bandeira e devolve as linhas no MESMO comando: duas chamadas ao mesmo tempo (a
 * varredura e o login, ou dois sims) não entregam a mesma linha duas vezes.
 */
export async function recolherDevolucoes(vendedorId) {
  const { rows } = await pool.query(
    `UPDATE market_anuncios SET devolucao_pendente = false
      WHERE id IN (
        SELECT id FROM market_anuncios
         WHERE vendedor_id = $1 AND devolucao_pendente
         ORDER BY id FOR UPDATE SKIP LOCKED
      )
      RETURNING id, vendedor_id, vendedor, tipo, estado, item_id, qtd, pokemon_id, ficha`,
    [vendedorId],
  );
  return rows.sort((a, b) => Number(a.id) - Number(b.id)).map(devolucaoDaLinha);
}

/** Quais destes jogadores têm devolução do servidor esperando. Uma query para o shard todo. */
export async function vendedoresComDevolucao(ids) {
  if (!ids?.length) return new Set();
  const { rows } = await pool.query(
    `SELECT DISTINCT vendedor_id FROM market_anuncios
      WHERE devolucao_pendente AND vendedor_id = ANY($1::bigint[])`,
    [ids],
  );
  return new Set(rows.map((r) => Number(r.vendedor_id)));
}

/**
 * Soma itens direto no banco. Só vale para quem não está carregado em sim nenhum — o flush de
 * um sim com o jogador em memória apagaria a soma. Por isso o Mercado não a usa mais: as
 * devoluções dele saem por `recolherDevolucoes`.
 */
export async function creditarItemNoBanco(playerId, itemId, qtd) {
  await pool.query(
    `UPDATE players
        SET items = jsonb_set(items, ARRAY[$2::text],
                      to_jsonb(COALESCE((items->>$2)::bigint, 0) + $3::bigint), true)
      WHERE id = $1`,
    [playerId, String(itemId), Number(qtd)],
  );
}

/**
 * Cancela anúncios abertos em ORB abaixo do mínimo e devolve a mercadoria.
 *
 * Mesma lógica da curadoria (`devolverAnunciosProibidos`): quem anunciou a 1 Gema receberia
 * 0 após a taxa de 15% — estado inválido que o novo código não deixa mais criar. Roda no
 * BOOT de cada sim (e pela ferramenta `market-preco-orb-invalido`), com gente conectada nos
 * outros: a devolução sai por `fecharParaDevolucao`, nunca por escrita direta em `players`.
 */
export function devolverAnunciosPrecoOrbInvalido() {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `SELECT id, vendedor_id, vendedor, tipo, item_id, qtd, pokemon_id, ficha, preco
         FROM market_anuncios
        WHERE estado = 'aberto' AND moeda = 'orb' AND preco < $1
        ORDER BY id FOR UPDATE`,
      [PRECO_MIN_ORB],
    );
    if (!rows.length) return [];

    await fecharParaDevolucao(cli, rows, 'cancelado');

    return rows.map((r) => ({
      id: Number(r.id),
      vendedor: r.vendedor,
      vendedorId: Number(r.vendedor_id),
      tipo: r.tipo,
      itemId: r.item_id == null ? null : Number(r.item_id),
      pokemonId: r.pokemon_id == null ? null : Number(r.pokemon_id),
      qtd: Number(r.qtd),
      nome: r.ficha?.nome ?? '',
      preco: Number(r.preco),
      caixaId: caixaDoAnuncio(r),
      casaId: casaDoAnuncio(r),
      bicicletaId: bicicletaDoAnuncio(r),
    }));
  });
}

/**
 * Cancela anúncios abertos em Coins abaixo do mínimo e devolve a mercadoria.
 *
 * Mesma lógica de `devolverAnunciosPrecoOrbInvalido`: quem anunciou a 1 Coin receberia
 * 0 após a taxa de 10% — estado inválido que o novo código não deixa mais criar.
 */
export function devolverAnunciosPrecoGoldInvalido() {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `SELECT id, vendedor_id, vendedor, tipo, item_id, qtd, pokemon_id, ficha, preco
         FROM market_anuncios
        WHERE estado = 'aberto' AND moeda = 'gold' AND preco < $1
        ORDER BY id FOR UPDATE`,
      [PRECO_MIN_GOLD],
    );
    if (!rows.length) return [];

    await fecharParaDevolucao(cli, rows, 'cancelado');

    return rows.map((r) => ({
      id: Number(r.id),
      vendedor: r.vendedor,
      vendedorId: Number(r.vendedor_id),
      tipo: r.tipo,
      itemId: r.item_id == null ? null : Number(r.item_id),
      pokemonId: r.pokemon_id == null ? null : Number(r.pokemon_id),
      qtd: Number(r.qtd),
      nome: r.ficha?.nome ?? '',
      preco: Number(r.preco),
      caixaId: caixaDoAnuncio(r),
      casaId: casaDoAnuncio(r),
      bicicletaId: bicicletaDoAnuncio(r),
    }));
  });
}

/** Um anúncio pelo id, sem trava. Leitura otimista — quem decide é o `FOR UPDATE` da compra. */
export async function anuncioPorId(id) {
  const { rows } = await pool.query(`SELECT * FROM market_anuncios WHERE id = $1`, [id]);
  return rows[0] ? linhaParaCliente(rows[0]) : null;
}

/** Quantos anúncios um jogador guarda nos Favoritos do Mercado. */
export const MAX_FAVORITOS = 60;

/**
 * Os anúncios dos FAVORITOS de um jogador, em QUALQUER estado — aberto, vendido ou cancelado.
 *
 * O fechado vem de propósito: a aba mostra "Vendido" no card em vez de o favorito sumir sem
 * explicação. `fechadoEm` vai junto para o sim podar o que saiu há dias. A junção é a mesma da
 * vitrine, pela mesma razão (ficha congelada sem data de captura).
 */
export async function anunciosPorIds(ids) {
  const lista = [...new Set((ids ?? []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))]
    .slice(0, MAX_FAVORITOS);
  if (!lista.length) return [];
  const { rows } = await pool.query(
    `SELECT ma.*, ${JOIN_PK_EXTRA}
       FROM market_anuncios ma
       LEFT JOIN player_pokemon pp ON pp.id = ma.pokemon_id
      WHERE ma.id = ANY($1::bigint[])`,
    [lista],
  );
  return rows.map((r) => ({ ...linhaParaCliente(r), fechadoEm: r.fechado_em?.getTime?.() ?? null }));
}

/** Histórico de vendas concluídas — um recibo por compra (inclui compras parciais). */
export async function historicoVendas(vendedorId, { pagina = 0, porPagina = 30 } = {}) {
  const { rows: cont } = await pool.query(
    `SELECT count(*)::int AS n FROM market_pagamentos WHERE vendedor_id = $1`,
    [vendedorId],
  );
  // A junção com o anúncio e o pokémon é a MESMA da Tabela de preços (`historicoGlobal`): é de
  // lá que saem os selos P·IV·Q·N do bicho vendido. Sem eles o extrato dizia "Hard Golem Nv
  // 100 por 300 mil" e mais nada — e o próprio vendedor não conseguia saber QUAL Hard Golem
  // era, se o P5 de 1.470 de qualidade ou o P1 de 700.
  const { rows } = await pool.query(
    `SELECT p.id, p.descricao, p.moeda, p.valor, p.bruto, p.comprador, p.criado_em,
            a.tipo, a.ficha, a.pokemon_id, ${JOIN_PK_EXTRA}
       FROM market_pagamentos p
       LEFT JOIN market_anuncios a ON a.id = p.anuncio_id
       LEFT JOIN player_pokemon pp ON pp.id = a.pokemon_id
      WHERE p.vendedor_id = $1
      ORDER BY p.criado_em DESC, p.id DESC
      LIMIT $2 OFFSET $3`,
    [vendedorId, porPagina, pagina * porPagina],
  );
  return {
    total: cont[0].n,
    pagina,
    porPagina,
    linhas: rows.map((r) => ({
      id: Number(r.id),
      descricao: r.descricao,
      moeda: r.moeda,
      valor: Number(r.valor),
      bruto: Number(r.bruto),
      comprador: r.comprador ?? null,
      em: r.criado_em?.getTime?.() ?? null,
      ...fichaDaLinhaDeHistorico(r),
    })),
  };
}

/**
 * O que o histórico PESSOAL (vendas e compras) leva do anúncio: o tipo e, só para pokémon, a
 * ficha congelada e o id do bicho — os mesmos campos que a Tabela de preços já mandava.
 */
const fichaDaLinhaDeHistorico = (r) => ({
  tipo: r.tipo ?? null,
  pokemonId: r.pokemon_id == null ? null : Number(r.pokemon_id),
  ficha: r.tipo === 'pokemon'
    ? fichaDoHistorico(r.ficha, r.pokemon_id, r.pk_caught_at, r.pk_tm_elemental, r.pk_tm_aoe)
    : null,
});

/** Histórico de compras concluídas — um recibo por compra (inclui compras parciais). */
export async function historicoCompras(compradorId, { pagina = 0, porPagina = 30 } = {}) {
  const { rows: cont } = await pool.query(
    `SELECT count(*)::int AS n FROM market_pagamentos WHERE comprador_id = $1`,
    [compradorId],
  );
  const { rows } = await pool.query(
    `SELECT p.id, p.descricao, p.moeda, p.valor, p.bruto, p.criado_em, a.vendedor,
            a.tipo, a.ficha, a.pokemon_id, ${JOIN_PK_EXTRA}
       FROM market_pagamentos p
       JOIN market_anuncios a ON a.id = p.anuncio_id
       LEFT JOIN player_pokemon pp ON pp.id = a.pokemon_id
      WHERE p.comprador_id = $1
      ORDER BY p.criado_em DESC, p.id DESC
      LIMIT $2 OFFSET $3`,
    [compradorId, porPagina, pagina * porPagina],
  );
  return {
    total: cont[0].n,
    pagina,
    porPagina,
    linhas: rows.map((r) => ({
      id: Number(r.id),
      descricao: r.descricao,
      moeda: r.moeda,
      valor: Number(r.valor),
      bruto: Number(r.bruto),
      vendedor: r.vendedor ?? null,
      em: r.criado_em?.getTime?.() ?? null,
      ...fichaDaLinhaDeHistorico(r),
    })),
  };
}

/** Até onde a tabela de preços deixa paginar — ver "O teto de páginas" abaixo. */
export const MAX_PAGINA_GLOBAL = 40;

/**
 * A TABELA DE PREÇOS: as vendas mais recentes do servidor inteiro, de todo mundo.
 *
 * ### É viável? É — e por um motivo específico
 *
 * Nada aqui é calculado: `market_pagamentos` JÁ é o recibo de toda compra do Mercado, gravado
 * uma linha por transação desde sempre, e já carrega descrição, moeda, valor bruto, comprador
 * e data. O histórico global é literalmente a mesma consulta do histórico pessoal SEM o
 * `WHERE vendedor_id` — nenhuma tabela nova, nenhum gatilho, nenhum agregado a manter.
 *
 * O custo real é só o do ÍNDICE, e ele é o `idx_mkt_pag_global` da migração: com ele a
 * consulta lê `porPagina + 1` linhas do topo do índice e para. Não cresce com o tamanho da
 * tabela.
 *
 * ### Por que NÃO há `count(*)`
 *
 * O histórico pessoal conta o total para desenhar "página 2 de 7", e ali isso é barato: o
 * índice por vendedor recorta algumas dezenas de linhas. No global o `count(*)` varreria a
 * tabela INTEIRA a cada abertura, e ela só cresce — seria o único ponto do painel com custo
 * proporcional à idade do servidor.
 *
 * A saída é pedir UMA linha a mais do que cabe na página: se ela veio, existe página
 * seguinte. Dá "‹ página 3 ›" em vez de "página 3 de 41", que é tudo que a navegação precisa.
 *
 * ### O teto de páginas
 *
 * `OFFSET` grande é lento mesmo com índice (o banco ainda pula linha a linha até chegar lá).
 * `MAX_PAGINA_GLOBAL` fecha esse flanco. Quem quer saber quanto vale um Charizard olha as
 * últimas semanas, não a página 4.000.
 */
export async function historicoGlobal({ pagina = 0, porPagina = 30, tipo = null, moeda = null, itemId = null } = {}) {
  const pag = Math.max(0, Math.min(MAX_PAGINA_GLOBAL, Math.floor(Number(pagina) || 0)));
  const tam = Math.max(1, Math.min(60, Math.floor(Number(porPagina) || 30)));
  const soTipo = tipo === 'pokemon' || tipo === 'item' || tipo === 'diamante' ? tipo : null;
  // Os dois recortes que a tabela ganhou: a MOEDA da venda (quem quer o preço em gema não quer a
  // lista entremeada de Coins) e UM item — só na aba de itens, onde a pedra, a Casa e a Caixa são
  // linhas de `tipo = 'item'` separadas pelo `item_id`.
  const soMoeda = moeda === 'gold' || moeda === 'orb' ? moeda : null;
  const item = Number(itemId);
  const soItem = soTipo === 'item' && Number.isSafeInteger(item) && item > 0 ? item : null;
  const args = [tam + 1, pag * tam];
  const cond = [];
  if (soTipo) cond.push(`a.tipo = $${args.push(soTipo)}`);
  if (soMoeda) cond.push(`p.moeda = $${args.push(soMoeda)}`);
  if (soItem) cond.push(`a.item_id = $${args.push(soItem)}`);
  const { rows } = await pool.query(
    `SELECT p.id, p.descricao, p.moeda, p.bruto, p.criado_em, p.comprador,
            a.vendedor, a.tipo, a.ficha, a.pokemon_id, ${JOIN_PK_EXTRA}
       FROM market_pagamentos p
       JOIN market_anuncios a ON a.id = p.anuncio_id
       LEFT JOIN player_pokemon pp ON pp.id = a.pokemon_id
      ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
      ORDER BY p.criado_em DESC, p.id DESC
      LIMIT $1 OFFSET $2`,
    args,
  );
  // `temMais` manda no botão "próxima" do cliente, e no TETO ele tem de mentir para baixo:
  // existem mais linhas, mas a página seguinte seria clampada de volta a esta e o jogador
  // clicaria em › vendo o mesmo conteúdo de novo, sem entender por quê.
  const temMais = rows.length > tam && pag < MAX_PAGINA_GLOBAL;
  return {
    pagina: pag,
    porPagina: tam,
    temMais,
    linhas: rows.slice(0, tam).map((r) => ({
      id: Number(r.id),
      descricao: r.descricao,
      tipo: r.tipo,
      moeda: r.moeda,
      // Só o BRUTO sai daqui — o que o comprador pagou. O líquido do vendedor é o bruto menos
      // a comissão, conta que só interessa a ele e que ninguém precisa saber do bolso alheio.
      // E é o bruto que serve de referência de preço, que é para o que este painel existe.
      bruto: Number(r.bruto),
      vendedor: r.vendedor ?? null,
      comprador: r.comprador ?? null,
      em: r.criado_em?.getTime?.() ?? null,
      // Os atributos do que foi vendido — só para pokémon.
      //
      // Sem isto a tabela de preços não serviria para o que existe: `descricao` é "Charizard
      // Nv 87", e dois Charizard Nv 87 podem valer cem vezes um do outro conforme potência,
      // IV, qualidade e shiny. "Vendeu por 2 milhões" só vira referência quando se sabe QUE
      // Charizard era.
      //
      // A ficha congelada do anúncio — mesma que a vitrine usa. Vai inteira para o cliente
      // abrir a ficha ao clicar na linha; o custo é só nas linhas de pokémon, e só neste
      // painel que alguém pediu para inspecionar o bicho antes de anunciar o próprio.
      // O id do bicho vai à parte da ficha: anúncio criado antes de a Identidade existir tem
      // a ficha congelada SEM `id`, e é daqui que o cliente tira o `#código` nesses casos.
      pokemonId: r.pokemon_id == null ? null : Number(r.pokemon_id),
      ficha: r.tipo === 'pokemon'
        ? fichaDoHistorico(r.ficha, r.pokemon_id, r.pk_caught_at, r.pk_tm_elemental, r.pk_tm_aoe)
        : null,
    })),
  };
}

/** Desembrulha a `ficha` JSONB do anúncio — null se vier vazia ou inválida. */
/**
 * A ficha congelada da venda, completada com o que ela pode não ter.
 *
 * `id` e `caughtAt` entraram na ficha depois que muita coisa já tinha sido vendida, e a ficha
 * é um SNAPSHOT — não volta atrás sozinha. Os dois campos, porém, são imutáveis e continuam
 * no `player_pokemon` (a venda troca o dono por UPDATE, não recria a linha), então a junção
 * os devolve. Pokémon vendido ao NPC e apagado depois não tem mais linha: aí fica sem data,
 * que é a verdade — não existe mais de quem perguntar.
 */
function fichaDoHistorico(bruta, pokemonId = null, caughtAt = null, tmElemental = null, tmAoe = null) {
  if (bruta == null) return null;
  const f = typeof bruta === 'string' ? JSON.parse(bruta) : bruta;
  if (!f || typeof f !== 'object') return null;
  const cheia = completarFichaPokemon(f, {
    pokemon_id: pokemonId,
    pk_caught_at: caughtAt,
    pk_tm_elemental: tmElemental,
    pk_tm_aoe: tmAoe,
  });
  if (cheia.id == null && pokemonId != null) cheia.id = Number(pokemonId);
  return cheia;
}

/** Os anúncios ABERTOS de um jogador — a aba "Meus anúncios". */
export async function meusAnuncios(vendedorId) {
  // A MESMA junção da vitrine, e pelo mesmo motivo: a ficha congelada de um anúncio criado
  // antes da data de captura existir não tem `caughtAt`, e sem isto a ficha do próprio bicho
  // ficava sem a linha "Capturado em" só porque ele está anunciado.
  const { rows } = await pool.query(
    `SELECT ma.*, ${JOIN_PK_EXTRA}
       FROM market_anuncios ma
       LEFT JOIN player_pokemon pp ON pp.id = ma.pokemon_id
      WHERE ma.vendedor_id = $1 AND ma.estado = 'aberto'
      ORDER BY ma.id DESC`,
    [vendedorId],
  );
  return rows.map(linhaParaCliente);
}

/**
 * Muda o preço (e a moeda) de um anúncio aberto.
 *
 * Só aceita fora da retenção inicial; ao salvar, reinicia `compravel_em` (+`COOLDOWN_COMPRA_MS`) para
 * impedir bait de preço com compra instantânea. Empilhar quantidade no mesmo anúncio não
 * passa por aqui — e também reinicia a retenção (ver a pilha em `criarAnuncio`).
 *
 * Editar QUANTIDADE não existe de propósito: mexer nela obrigaria a tirar ou devolver item
 * do inventário no mesmo movimento, e isso é exatamente o que cancelar-e-reanunciar já faz,
 * com menos caminho para dar errado.
 */
export function editarAnuncio({ id, vendedorId, preco, moeda }) {
  // A conferência de MOEDA vem primeiro, e não é redundância com as duas linhas abaixo: elas
  // só mordem quando a moeda é uma das conhecidas. Com uma moeda forjada ("xyz"), as duas
  // passavam de largo e um preço negativo entrava na linha — o anúncio virava um pagamento
  // negativo na caixa postal do vendedor na primeira compra.
  if (!MOEDAS_MERCADO.has(moeda)) throw new Error(`moeda inválida no anúncio: ${moeda}`);
  conferirNumerosDoAnuncio({ qtd: 1, preco: Number(preco) });
  if (moeda === 'orb' && preco < PRECO_MIN_ORB) throw new Error(msgPrecoMinOrb());
  if (moeda === 'gold' && preco < PRECO_MIN_GOLD) throw new Error(msgPrecoMinGold());
  return comTransacao(async (cli) => {
    const { rows: lock } = await cli.query(
      `SELECT id FROM market_anuncios
        WHERE id = $1 AND vendedor_id = $2 AND estado = 'aberto'
        FOR UPDATE`,
      [id, vendedorId],
    );
    if (!lock.length) throw new Error('anúncio não está aberto');

    const { rows: chk } = await cli.query(
      `SELECT (compravel_em IS NOT NULL AND compravel_em > now()) AS retido
         FROM market_anuncios WHERE id = $1`,
      [id],
    );
    if (chk[0]?.retido) {
      throw new Error('este anúncio ainda está em retenção — aguarde para editar');
    }

    const { rows } = await cli.query(
      `UPDATE market_anuncios SET preco = $2, moeda = $3,
              compravel_em = now() + ($4::int * INTERVAL '1 millisecond')
        WHERE id = $1
        RETURNING *`,
      [id, preco, moeda, COOLDOWN_COMPRA_MS],
    );
    return linhaParaCliente(rows[0]);
  });
}

// ----------------------------------------------------------- caixa postal

/**
 * Recolhe os pagamentos pendentes de um vendedor e devolve o que o sim tem de somar.
 *
 * Marca como recolhido DENTRO da transação e só então devolve — se o processo morrer no
 * meio, o COMMIT não aconteceu e o pagamento continua pendente para a próxima. O contrário
 * (devolver e marcar depois) pagaria duas vezes.
 *
 * O ORB é creditado aqui mesmo, com ledger: `players.orbs` não passa pelo flush, então não
 * há o que o sim possa sobrescrever. O sim só precisa do saldo novo para a tela.
 */
export function recolherPagamentos(vendedorId) {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `UPDATE market_pagamentos SET recolhido_em = now()
        WHERE id IN (
          SELECT id FROM market_pagamentos
           WHERE vendedor_id = $1 AND recolhido_em IS NULL
           ORDER BY id FOR UPDATE SKIP LOCKED
        )
        RETURNING *`,
      [vendedorId],
    );
    if (!rows.length) return { gold: 0, orbs: 0, saldoOrbs: null, recibos: [] };

    const gold = rows.filter((r) => r.moeda === 'gold').reduce((s, r) => s + Number(r.valor), 0);
    const orbs = rows.filter((r) => r.moeda === 'orb').reduce((s, r) => s + Number(r.valor), 0);

    let saldoOrbs = null;
    if (orbs > 0) {
      const orbRows = rows.filter((r) => r.moeda === 'orb');
      const notaOrb = orbRows
        .map((r) => {
          let s = String(r.descricao ?? 'item').trim();
          if (r.comprador) s += ` · comprador ${r.comprador}`;
          return s;
        })
        .join('; ')
        .slice(0, 480) || `${orbRows.length} venda(s)`;

      const { rows: cred } = await cli.query(
        `UPDATE players SET orbs = orbs + $2 WHERE id = $1 RETURNING orbs`,
        [vendedorId, orbs],
      );
      saldoOrbs = Number(cred[0].orbs);
      await cli.query(
        `INSERT INTO orb_ledger (player_id, delta, saldo_apos, motivo, ref, nota)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [vendedorId, orbs, saldoOrbs, MOTIVO.MARKET_VENDA, `mercado`, notaOrb],
      );
    }

    return {
      gold,
      orbs,
      saldoOrbs,
      recibos: rows.map((r) => ({
        descricao: r.descricao,
        comprador: r.comprador,
        moeda: r.moeda,
        valor: Number(r.valor),
        bruto: Number(r.bruto),
      })),
    };
  });
}

/**
 * Quais destes jogadores têm pagamento esperando.
 *
 * Uma query para o shard inteiro. É o que permite ao sim varrer a caixa postal de mil
 * pessoas conectadas sem fazer mil consultas.
 */
export async function vendedoresComPagamento(ids) {
  if (!ids?.length) return new Set();
  const { rows } = await pool.query(
    `SELECT DISTINCT vendedor_id FROM market_pagamentos
      WHERE recolhido_em IS NULL AND vendedor_id = ANY($1::bigint[])`,
    [ids],
  );
  return new Set(rows.map((r) => Number(r.vendedor_id)));
}

/** Recalcula `ficha.nota` de anúncios de pokémon — roda no boot e via `tools/recalcular-notas-anuncios.mjs`. */
export async function recalcularNotasAnuncios({ soAbertos = true } = {}) {
  const cond = soAbertos ? `tipo = 'pokemon' AND estado = 'aberto'` : `tipo = 'pokemon'`;
  const { rows } = await pool.query(`SELECT id, ficha FROM market_anuncios WHERE ${cond}`);
  let atualizados = 0;
  for (const r of rows) {
    const ficha = typeof r.ficha === 'string' ? JSON.parse(r.ficha) : { ...r.ficha };
    const nota = notaMercadoDoPokemon(ficha, especies);
    if (nota == null) continue;
    const antiga = Number(ficha.nota);
    if (Number.isFinite(antiga) && Math.abs(antiga - nota) < 0.0005) continue;
    ficha.nota = nota;
    await pool.query('UPDATE market_anuncios SET ficha = $1::jsonb WHERE id = $2', [JSON.stringify(ficha), r.id]);
    atualizados++;
  }
  return { total: rows.length, atualizados };
}

/** @deprecated alias — preenche e realinha notas congeladas na ficha. */
export async function backfillNotaAnuncios() {
  return recalcularNotasAnuncios({ soAbertos: true });
}

/**
 * Comissão de 15% nas vendas em gemas (`bruto − valor` em `market_pagamentos`).
 *
 * Não inclui `taxa_paga` dos anúncios — aquilo é a pensão diária do pokémon, paga em Coins.
 */
export async function totaisTaxasMercadoGemas() {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(bruto - valor), 0)::bigint AS taxa
       FROM market_pagamentos
      WHERE moeda = 'orb'`,
  );
  return Number(rows[0]?.taxa ?? 0);
}
