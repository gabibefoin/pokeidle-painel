#!/usr/bin/env node
/**
 * O RESET DO FIM DO BETA — 07/09/2026.
 *
 * Zera o mundo mantendo as contas de pé e devolvendo o que foi prometido no anúncio de
 * lançamento. Roda numa transação só: ou o servidor inteiro atravessa o reset, ou nada
 * acontece. `--dry-run` executa tudo e dá ROLLBACK no fim — o relatório é REAL, medido sobre
 * o banco de verdade, e nada é gravado.
 *
 *   node tools/reset-beta.mjs --dry-run
 *   node tools/reset-beta.mjs --confirmar
 *   node tools/reset-beta.mjs --confirmar --relatorio ../reset-beta.json
 *
 * PARE O SERVIDOR ANTES (`npm run stop`). O jogo é write-behind: um jogador online tem o
 * estado dele em MEMÓRIA e o flush seguinte gravaria o inventário do beta por cima do reset.
 *
 * ### O que SOBREVIVE
 *
 * 1. **A conta.** Login, e-mail, nick, gênero e visual do treinador. Ninguém é excluído.
 * 2. **Shinys e P5.** Vão para o DEPOT, com IVs, qualidade, potência, REFINO, TM elemental e
 *    TM AoE intactos — só o NÍVEL cai (ver "o nível" abaixo). Os que estavam anunciados no
 *    Mercado da Comunidade voltam para o dono, também no Depot.
 * 3. **Casa Lendária.** Fica na bolsa; a que estava anunciada volta para lá. As outras quatro
 *    raridades somem com o resto dos itens.
 * 4. **Caixas de Fundador e CoFundador.** A tabela `caixas_beta` não é tocada: caixa FECHADA
 *    continua na bolsa (a anunciada sai do escrow e volta para o dono) e caixa ABERTA mantém
 *    a outfit e a tag do chat, que são derivadas dessa tabela em todo login.
 * 5. **Diamantes e gemas.** Ver "as duas moedas".
 * 6. **Outfits de beta e de caixa.** As skins compradas com diamante saem — o diamante gasto
 *    nelas volta no reembolso.
 *
 * ### O nível dos shinys/P5
 *
 * É o **nível de captura** da espécie: o mesmo número que a ficha da Pokédex mostra em "Nível
 * ao capturar". Sai do menor degrau de hunt em que a espécie aparece, cortado pelo teto de
 * captura dela (`shared/teto-captura.mjs`).
 *
 *   Charizard  hunt 80     · teto 100 → nível 80
 *   Treecko    hunt 20     · teto 20  → nível 20
 *   Sylveon    hunt 12.750 · teto 100 → nível 100   (o 12.750 é cortado)
 *
 * O teto é o que impede o reset de PROMOVER alguém: sem ele, um shiny Sylveon nível 200 iria
 * para 12.750, que é o degrau de hunt da espécie em Kalos. Nenhum pokémon sai deste script
 * acima de 100.
 *
 * ### As duas moedas
 *
 * **Diamante** é reconstruído, não preservado: o saldo final é o TOTAL COMPRADO (soma de
 * `diamante_pagamentos` pagos — a mesma conta da coluna "diamantes p/reset" do painel de
 * admin) MAIS o conteúdo de cada Caixa de Fundador que a pessoa ABRIU (150 💎 na de Fundador,
 * 100 na de CoFundador). A caixa aberta entra porque os diamantes de dentro dela já foram
 * gastos ou estão no saldo que este script está prestes a sobrescrever; a caixa FECHADA não
 * entra, porque os diamantes continuam dentro dela. Diamante ganho por bug ou pelo programa
 * de afiliados não sobrevive — é exatamente o que a conta do total comprado deixa de fora.
 *
 * **Gema** é preservada e ainda SOBE um pouco. `players.orbs` não é tocado — ela tem lastro em
 * USDT e o `orb_ledger` é a verdade. O que sobe é a caixa postal do Mercado: uma venda em gema
 * cujo vendedor não voltou ao jogo desde que vendeu está num terceiro lugar (o comprador já
 * foi debitado, o vendedor nunca foi creditado), invisível no saldo e no ledger. O reset
 * recolhe essas vendas por ele, com a mesma escrita que o login faria. Ver o bloco da caixa
 * postal, no passo 1.
 *
 * ### Depois de rodar
 *
 * Ponha `BETA_OUTFITS_ABERTAS=0` no `.env` para as Beta Outfits saírem da vitrine (quem já
 * resgatou continua equipando — ver `game/loja.mjs`).
 */
import { pool } from '../src/server/db.mjs';
import {
  especies,
  huntsJogaveis,
  xpTotalParaNivel,
  calcularStats,
  hpDeCombate,
  multDeNascenca,
  nivelDeCapturaDe,
} from '../src/server/content.mjs';
import { poderDePokemon, POTENCIA_MAX } from '../src/shared/nota-pokemon.mjs';
import { normalizarRefino } from '../src/shared/refino-stats.mjs';
import { CASA_POR_RARIDADE } from '../src/server/game/itens-nossos.mjs';
import { LISTA_CAIXAS, LOOKTYPES_CAIXA_BETA, caixaPorTipo } from '../src/shared/caixas-beta.mjs';
import { LOOKTYPES_OUTFIT_BETA } from '../src/server/game/loja.mjs';
import { corpoPadrao, CORPO_DO_GENERO } from '../src/server/game/visual.mjs';
import { movimentarNaTransacao } from '../src/server/diamantes-db.mjs';
import { MOTIVO } from '../src/server/game/diamantes.mjs';
import { MOTIVO as ORB_MOTIVO } from '../src/server/game/orbs.mjs';
import { writeFile } from 'node:fs/promises';

// --------------------------------------------------------------------- argumentos

const args = process.argv.slice(2);
const tem = (n) => args.includes(n);
const valor = (n, padrao = null) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : padrao;
};

const DRY = tem('--dry-run');
const CONFIRMADO = tem('--confirmar');
const ARQUIVO_RELATORIO = valor('--relatorio');

if (!DRY && !CONFIRMADO) {
  console.error(`
O reset do fim do beta reescreve o banco INTEIRO. Escolha um dos dois:

  node tools/reset-beta.mjs --dry-run      simula e mostra o relatório (nada é gravado)
  node tools/reset-beta.mjs --confirmar    executa de verdade

Pare o servidor antes (npm run stop) e tenha um backup à mão.
`);
  process.exit(1);
}

/**
 * O ouro de uma conta nova. É o DEFAULT da coluna em `sql/schema.sql`, repetido aqui porque o
 * UPDATE precisa de um número — quem resetou tem de ficar igual a quem se cadastrar amanhã.
 */
const GOLD_INICIAL = Number(valor('--gold', 500));

/** A bolsa inicial: 100 Poké Balls, o mesmo default de `players.balls` no schema. */
const BALLS_INICIAIS = { 1: 100 };

const CASA_LENDARIA = CASA_POR_RARIDADE.lendaria;

/** Os looktypes que atravessam o reset: as quatro Beta Outfits e as duas de caixa. */
const OUTFITS_QUE_FICAM = new Set([
  ...LOOKTYPES_OUTFIT_BETA,
  ...LOOKTYPES_CAIXA_BETA,
  ...Object.values(CORPO_DO_GENERO),
]);

/**
 * Tabelas apagadas inteiras, na ordem em que as chaves estrangeiras permitem.
 *
 * O critério não é "é do beta", é **ficaria inconsistente**: toda linha daqui aponta para um
 * pokémon que este script apaga, para um ouro que ele zera ou para um ranking que ele
 * reinicia. O que é histórico financeiro (`diamante_*`, `orb_*`, `affiliate_*`, `topidle_*`),
 * social (`amizades`, chat) ou de auditoria fica de pé — o reembolso é calculado em cima do
 * primeiro grupo, e apagá-lo seria apagar a prova de quem pagou.
 */
const TABELAS_ZERADAS = [
  'market_pagamentos', // caixa postal do Mercado: ouro e gema de venda não recolhida
  'market_anuncios', // a vitrine inteira (o escrow já foi solto antes)
  'ginasio_desafio_cd',
  'ginasio_times', // times de ginásio guardam ids de pokémon que deixam de existir
  'ginasio_lideres',
  'guild_pvp_registros',
  'guild_pvp_batalhas',
  'guild_pvp_equipes',
  'guild_pvp_eventos',
  'guild_global_temporadas',
  'guild_invites',
  'guild_members',
  'guilds',
  'amigo_coin_mailbox', // ouro de amigo esperando recolha
  'eventos_buff', // buffs do evento de boost pré-reset
];

// ------------------------------------------------------------------ nível de hunt

/**
 * O menor degrau de hunt em que a espécie aparece.
 *
 * É o mesmo `nivelRef` que a ficha da Pokédex calcula no cliente (`app.js`): MENOR e não
 * maior, porque as dezoito espécies que moram em duas hunts de eras diferentes precisam
 * contar UMA história só — a lista, a ficha e a promessa de evolução da pré-evolução.
 */
const nivelDeHuntPorEspecie = new Map();
for (const h of huntsJogaveis) {
  for (const e of h.especies) {
    const atual = nivelDeHuntPorEspecie.get(e.pokeId);
    if (atual == null || h.nivel < atual) nivelDeHuntPorEspecie.set(e.pokeId, h.nivel);
  }
}

/** O nível com que a espécie SAI DE UMA BOLA — o "Nível ao capturar" da ficha da Pokédex. */
function nivelDeReset(speciesId) {
  const esp = especies.get(Number(speciesId));
  if (!esp) return null;
  const ref = Math.max(1, Math.round(nivelDeHuntPorEspecie.get(esp.pokeId) ?? esp.huntLevel ?? 5));
  return Math.max(1, Math.round(nivelDeCapturaDe(esp, ref)));
}

// ------------------------------------------------------------------------ util

const n = (v) => Number(v ?? 0);
const jsonDe = (v) => (typeof v === 'string' ? JSON.parse(v) : (v ?? null));
const fmt = (v) => Number(v).toLocaleString('pt-BR');

/** Fatia uma lista em lotes — os UPDATE em massa vão por `unnest`, não uma query por linha. */
function* lotes(lista, tamanho = 500) {
  for (let i = 0; i < lista.length; i += tamanho) yield lista.slice(i, i + tamanho);
}

const rel = {
  em: new Date().toISOString(),
  modo: DRY ? 'dry-run' : 'executado',
  goldInicial: GOLD_INICIAL,
};

// ---------------------------------------------------------------------- execução

const cli = await pool.connect();
const t0 = Date.now();
let commitou = false;

try {
  await cli.query('BEGIN');

  // ------------------------------------------------------------------ a TRAVA
  //
  // O fim do beta acontece UMA vez. Rodar este script de novo num mundo em produção apagaria
  // o progresso de todo mundo — e desta vez sem nada para devolver, porque o "total comprado"
  // já foi creditado e a segunda passada só zeraria por cima.
  //
  // O carimbo mora em `game_meta`, no BANCO, e não num arquivo ou numa variável de ambiente,
  // porque é o banco que ele protege: um clone da produção, um restore de backup ou uma cópia
  // do repositório em outra máquina levam o carimbo junto e continuam trancados. `--dry-run`
  // cai na mesma trava de propósito: uma simulação sobre o mundo já resetado não responde
  // nenhuma pergunta útil e só serve para alguém tirar o `--dry-run` da linha de comando.
  //
  // Para destravar de verdade é preciso apagar a linha na mão, no banco — um ato deliberado,
  // que ninguém faz por engano num deploy.
  const { rows: [meta] } = await cli.query(
    `SELECT (SELECT valor FROM game_meta WHERE chave = 'reset_beta_feito') AS feito
       WHERE to_regclass('game_meta') IS NOT NULL`,
  );
  if (meta?.feito) {
    await cli.query('ROLLBACK');
    cli.release();
    console.error(`
✖ ESTE BANCO JÁ PASSOU PELO RESET DO FIM DO BETA (${meta.feito}).

  O reset é irrepetível: rodar de novo apagaria o progresso de todo mundo sem ter o que
  devolver, porque o reembolso do total comprado já foi creditado uma vez.

  Se você REALMENTE precisa rodar de novo (um banco de teste, por exemplo), apague o
  carimbo na mão:

    DELETE FROM game_meta WHERE chave = 'reset_beta_feito';
`);
    await pool.end();
    process.exit(1);
  }

  // A coluna que faz o jogador reencontrar a tela de "Escolher Inicial" (ver `sim.mjs`). O
  // `migrar()` do boot também a cria — repetir aqui é o que permite rodar o reset num banco
  // restaurado antes de o servidor novo ter subido uma vez.
  await cli.query(
    `ALTER TABLE players ADD COLUMN IF NOT EXISTS reset_starter BOOLEAN NOT NULL DEFAULT false`,
  );

  const { rows: [antes] } = await cli.query(`
    SELECT (SELECT count(*)::int FROM players)            AS jogadores,
           (SELECT count(*)::int FROM accounts)           AS contas,
           (SELECT count(*)::int FROM player_pokemon)     AS pokemons,
           (SELECT count(*)::int FROM player_pokemon WHERE shiny)                     AS shinys,
           (SELECT count(*)::int FROM player_pokemon WHERE potencia = ${POTENCIA_MAX}) AS p5,
           (SELECT coalesce(sum(gold),0)::bigint    FROM players) AS gold,
           (SELECT coalesce(sum(diamonds),0)::bigint FROM players) AS diamantes,
           (SELECT coalesce(sum(orbs),0)::bigint     FROM players) AS gemas,
           (SELECT count(*)::int FROM caixas_beta)                AS caixas
  `);
  rel.antes = {
    jogadores: n(antes.jogadores), contas: n(antes.contas), pokemons: n(antes.pokemons),
    shinys: n(antes.shinys), p5: n(antes.p5),
    gold: n(antes.gold), diamantes: n(antes.diamantes), gemas: n(antes.gemas),
    caixas: n(antes.caixas),
  };

  // ------------------------------------------------------- 1. Mercado da Comunidade
  //
  // Primeiro passo de propósito: os anúncios abertos são um ESCROW, e o que está lá dentro
  // ainda pertence a alguém. Fechar o Mercado depois de apagar os pokémon perderia a única
  // pista de quem era o dono de um shiny em vitrine.

  const { rows: abertos } = await cli.query(
    `SELECT id, vendedor_id, tipo, item_id, qtd, pokemon_id, ficha, moeda
       FROM market_anuncios WHERE estado = 'aberto'`,
  );

  /** Casas Lendárias anunciadas voltam para a bolsa do vendedor: { playerId → quantidade }. */
  const casasDevolvidas = new Map();
  let anunciosPokemon = 0;
  let anunciosCaixa = 0;
  let anunciosItemDescartado = 0;

  for (const a of abertos) {
    const ficha = jsonDe(a.ficha) ?? {};
    const ehCaixa = Number(ficha.caixaId) > 0;
    if (a.tipo === 'pokemon') { anunciosPokemon++; continue; }
    if (ehCaixa) { anunciosCaixa++; continue; }
    if (Number(a.item_id) === CASA_LENDARIA) {
      const id = n(a.vendedor_id);
      casasDevolvidas.set(id, (casasDevolvidas.get(id) ?? 0) + Math.max(1, n(a.qtd)));
      continue;
    }
    anunciosItemDescartado++;
  }

  // ------------------------------------------------ a caixa postal do Mercado
  //
  // Vender no Mercado não credita ninguém na hora: o pagamento fica anotado em
  // `market_pagamentos` e o sim do vendedor recolhe no login seguinte (ver o cabeçalho de
  // `market-db.mjs` para o porquê — o flush sobrescreveria um crédito direto).
  //
  // O OURO pendente é descartado com o resto: todo saldo vai a zero de qualquer forma.
  //
  // A GEMA não. Ela tem lastro em USDT, e uma venda pendente está num terceiro lugar: o
  // comprador JÁ foi debitado (com linha no ledger) e o vendedor nunca foi creditado, então
  // ela não aparece nem em `players.orbs` nem no `orb_ledger` — nem na coluna "gemas p/reset"
  // do painel de admin, que lê o saldo. Apagar a tabela sem creditar faria essas gemas
  // evaporarem: o jogador que vendeu hoje de manhã e loga à tarde não acharia o dinheiro, e a
  // tesouraria ficaria com o USDT sem passivo do outro lado.
  //
  // Então este bloco faz o que o login faria — a mesma escrita de `recolherPagamentos`, saldo
  // e ledger na mesma transação — só que para todo mundo de uma vez.
  const { rows: [postal] } = await cli.query(`
    SELECT coalesce(sum(valor) FILTER (WHERE moeda = 'orb'), 0)::bigint  AS gemas,
           coalesce(sum(valor) FILTER (WHERE moeda = 'gold'), 0)::bigint AS gold,
           count(*) FILTER (WHERE moeda = 'orb')::int                    AS linhas_gema
      FROM market_pagamentos WHERE recolhido_em IS NULL
  `);

  const { rows: pendentesOrb } = await cli.query(`
    UPDATE market_pagamentos SET recolhido_em = now()
      WHERE recolhido_em IS NULL AND moeda = 'orb'
      RETURNING vendedor_id, valor
  `);
  const gemasPorVendedor = new Map();
  for (const r of pendentesOrb) {
    const id = n(r.vendedor_id);
    const atual = gemasPorVendedor.get(id) ?? { gemas: 0, vendas: 0 };
    atual.gemas += n(r.valor);
    atual.vendas++;
    gemasPorVendedor.set(id, atual);
  }
  for (const [playerId, { gemas, vendas }] of gemasPorVendedor) {
    if (gemas <= 0) continue;
    const { rows: [cred] } = await cli.query(
      `UPDATE players SET orbs = orbs + $2 WHERE id = $1 RETURNING orbs`,
      [playerId, gemas],
    );
    await cli.query(
      `INSERT INTO orb_ledger (player_id, delta, saldo_apos, motivo, ref, nota)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [playerId, gemas, n(cred.orbs), ORB_MOTIVO.MARKET_VENDA, 'mercado',
       `${vendas} venda(s) recolhida(s) no reset do fim do beta`],
    );
  }

  // Solta o escrow ANTES de apagar os anúncios: `player_pokemon.anuncio_id` e
  // `caixas_beta.anuncio_id` não têm FK, então um DELETE nos anúncios deixaria os dois campos
  // apontando para um id morto — e um pokémon com `anuncio_id` preenchido some da mão do dono
  // (`carregarOuCriarJogador` filtra por `anuncio_id IS NULL`).
  const escrowPk = await cli.query(
    `UPDATE player_pokemon SET anuncio_id = NULL, slot = NULL WHERE anuncio_id IS NOT NULL`,
  );
  const escrowCaixa = await cli.query(
    `UPDATE caixas_beta SET anuncio_id = NULL WHERE anuncio_id IS NOT NULL`,
  );

  rel.mercado = {
    anunciosAbertos: abertos.length,
    anunciosPokemon,
    anunciosCaixa,
    anunciosItemDescartado,
    casasLendariasDevolvidas: [...casasDevolvidas.values()].reduce((s, v) => s + v, 0),
    pokemonsSoltosDoEscrow: escrowPk.rowCount,
    caixasSoltasDoEscrow: escrowCaixa.rowCount,
    caixaPostal: {
      gemasCreditadas: n(postal.gemas),
      linhasDeGema: n(postal.linhas_gema),
      vendedoresCreditados: gemasPorVendedor.size,
      goldDescartado: n(postal.gold),
    },
  };

  // -------------------------------------------------------------------- 2. Pokémon

  const { rows: mantidos } = await cli.query(
    `SELECT id, player_id, species_id, level, ivs, quality, potencia, shiny, bonus_base,
            tm_elemental, tm_aoe
       FROM player_pokemon
      WHERE shiny = true OR potencia = ${POTENCIA_MAX}
      ORDER BY id`,
  );

  const apagados = await cli.query(
    `DELETE FROM player_pokemon WHERE NOT (shiny = true OR potencia = ${POTENCIA_MAX})`,
  );

  const semEspecie = [];
  const novos = [];
  let subiramDeNivel = 0;
  let comRefino = 0;
  let comTm = 0;

  for (const r of mantidos) {
    const esp = especies.get(Number(r.species_id));
    const nivel = nivelDeReset(r.species_id);
    if (!esp || nivel == null) {
      // Espécie que saiu do catálogo. Não inventa nível: mantém a linha como está e reporta,
      // porque adivinhar aqui é entregar ao jogador um bicho que o servidor não sabe desenhar.
      semEspecie.push({ id: n(r.id), speciesId: n(r.species_id), playerId: n(r.player_id) });
      continue;
    }
    const ivs = jsonDe(r.ivs) ?? {};
    const refino = normalizarRefino(jsonDe(r.bonus_base));
    const potencia = Number(r.potencia) || 1;
    const stats = calcularStats(esp, ivs, nivel, r.quality, multDeNascenca(potencia, r.shiny), refino);
    if (nivel > Number(r.level)) subiramDeNivel++;
    if (Object.values(refino).some((v) => v > 0)) comRefino++;
    if (r.tm_elemental || r.tm_aoe) comTm++;
    novos.push({
      id: n(r.id),
      level: nivel,
      xp: xpTotalParaNivel(nivel),
      hp: hpDeCombate(stats.hp),
      power: poderDePokemon(
        { ivs, quality: r.quality, potencia, shiny: r.shiny, refino, level: nivel },
        esp,
      ),
    });
  }

  for (const lote of lotes(novos)) {
    await cli.query(
      `UPDATE player_pokemon pp
          SET level = d.level, xp = d.xp, hp = d.hp, power = d.power,
              slot = NULL, held_item_id = NULL, starter = false, anuncio_id = NULL
         FROM (SELECT * FROM unnest($1::bigint[], $2::int[], $3::bigint[], $4::int[], $5::int[])
                 AS t(id, level, xp, hp, power)) d
        WHERE pp.id = d.id`,
      [
        lote.map((x) => x.id), lote.map((x) => x.level), lote.map((x) => x.xp),
        lote.map((x) => x.hp), lote.map((x) => x.power),
      ],
    );
  }

  const { rows: [porTipo] } = await cli.query(`
    SELECT count(*) FILTER (WHERE shiny AND potencia = ${POTENCIA_MAX})::int AS ambos,
           count(*) FILTER (WHERE shiny AND potencia <> ${POTENCIA_MAX})::int AS so_shiny,
           count(*) FILTER (WHERE NOT shiny AND potencia = ${POTENCIA_MAX})::int AS so_p5,
           count(DISTINCT player_id)::int AS jogadores
      FROM player_pokemon
  `);

  rel.pokemons = {
    apagados: apagados.rowCount,
    mantidos: mantidos.length,
    soShiny: n(porTipo.so_shiny),
    soP5: n(porTipo.so_p5),
    shinyEP5: n(porTipo.ambos),
    jogadoresComPokemon: n(porTipo.jogadores),
    comRefinoPreservado: comRefino,
    comTmPreservado: comTm,
    subiramDeNivel,
    semEspecieNoCatalogo: semEspecie,
  };

  // --------------------------------------------------------- 3. Caixas de Fundador

  const { rows: caixas } = await cli.query(`
    SELECT tipo,
           count(*) FILTER (WHERE aberta_em IS NOT NULL)::int AS abertas,
           count(*) FILTER (WHERE aberta_em IS NULL)::int     AS fechadas
      FROM caixas_beta GROUP BY tipo
  `);
  const { rows: aberturas } = await cli.query(
    `SELECT aberta_por AS player_id, tipo FROM caixas_beta
      WHERE aberta_em IS NOT NULL AND aberta_por IS NOT NULL`,
  );

  /** { playerId → diamantes que estavam dentro das caixas que ele abriu }. */
  const bonusCaixa = new Map();
  for (const a of aberturas) {
    const def = caixaPorTipo(a.tipo);
    if (!def) continue;
    const id = n(a.player_id);
    bonusCaixa.set(id, (bonusCaixa.get(id) ?? 0) + def.diamantes);
  }

  rel.caixas = {
    porTipo: Object.fromEntries(caixas.map((c) => [c.tipo, {
      abertas: n(c.abertas), fechadas: n(c.fechadas),
    }])),
    jogadoresComCaixaAberta: bonusCaixa.size,
    diamantesDevolvidosPorCaixa: [...bonusCaixa.values()].reduce((s, v) => s + v, 0),
    limites: Object.fromEntries(LISTA_CAIXAS.map((c) => [c.tipo, {
      limite: c.limite, diamantesDentro: c.diamantes,
    }])),
  };

  // ------------------------------------------------------------------ 4. Jogadores

  const { rows: jogadores } = await cli.query(
    `SELECT id, nick, gender, looktype, owned_outfits, items, diamonds FROM players ORDER BY id`,
  );

  const linhas = [];
  let comCasaLendaria = 0;
  let outfitsRemovidas = 0;
  let looktypesTrocados = 0;

  for (const j of jogadores) {
    const id = n(j.id);
    const items = jsonDe(j.items) ?? {};

    // A bolsa nova: só a Casa Lendária, somando a que estava anunciada no Mercado.
    const casas = n(items[String(CASA_LENDARIA)]) + (casasDevolvidas.get(id) ?? 0);
    const novaBolsa = casas > 0 ? { [CASA_LENDARIA]: casas } : {};
    if (casas > 0) comCasaLendaria++;

    const outfits = (jsonDe(j.owned_outfits) ?? []).map(Number).filter(Number.isFinite);
    const novasOutfits = outfits.filter((lt) => OUTFITS_QUE_FICAM.has(lt));
    outfitsRemovidas += outfits.length - novasOutfits.length;

    // A outfit equipada só volta ao padrão se a que ele usava foi embora — quem está de Beta
    // Outfit ou de outfit de Fundador continua exatamente como estava ao fechar o jogo.
    const lookAtual = Number(j.looktype);
    const look = OUTFITS_QUE_FICAM.has(lookAtual) ? lookAtual : corpoPadrao(j.gender);
    if (look !== lookAtual) looktypesTrocados++;

    linhas.push({ id, items: JSON.stringify(novaBolsa), outfits: JSON.stringify(novasOutfits), look });
  }

  for (const lote of lotes(linhas)) {
    await cli.query(
      `UPDATE players p SET
         level = 1, xp = 0, gold = $5,
         hunt_slug = NULL, active_poke = NULL,
         items = d.items, balls = $6::jsonb,
         automation = '{}'::jsonb, pokedex = '{}'::jsonb,
         boss_points = 0, outland_tier = 1, frag_chave_total = 0,
         elo = 1000, pvp_abates = 0, pvp_mortes = 0, pvp_cooldown_ate = 0,
         vip_ate = 0, boosts = '{}'::jsonb, boosts_hoje = '{}'::jsonb,
         bless = NULL, compras_cooldown = '{}'::jsonb,
         xp_share = '[]'::jsonb, xp_share_total = 0,
         owned_outfits = d.outfits, looktype = d.look,
         reset_starter = true
       FROM (SELECT * FROM unnest($1::bigint[], $2::jsonb[], $3::jsonb[], $4::int[])
               AS t(id, items, outfits, look)) d
      WHERE p.id = d.id`,
      [
        lote.map((x) => x.id), lote.map((x) => x.items),
        lote.map((x) => x.outfits), lote.map((x) => x.look),
        GOLD_INICIAL, JSON.stringify(BALLS_INICIAIS),
      ],
    );
  }

  rel.jogadores = {
    resetados: linhas.length,
    comCasaLendaria,
    outfitsRemovidas,
    looktypesVoltaramAoPadrao: looktypesTrocados,
  };

  // ------------------------------------------------------------------ 5. Diamantes
  //
  // Depois do UPDATE dos jogadores, e não antes: `movimentarNaTransacao` grava o saldo no
  // `diamante_ledger`, e o ledger tem de registrar o número FINAL. Se o UPDATE de cima
  // mexesse em `diamonds` (não mexe, de propósito), o extrato do jogador mentiria.

  const { rows: pagos } = await cli.query(
    `SELECT player_id, sum(qtd)::bigint AS total
       FROM diamante_pagamentos WHERE status = 'pago' GROUP BY player_id`,
  );
  const comprado = new Map(pagos.map((r) => [n(r.player_id), n(r.total)]));

  let creditados = 0;
  let debitados = 0;
  let jogadoresAjustados = 0;
  const alvos = [];

  for (const j of jogadores) {
    const id = n(j.id);
    const alvo = (comprado.get(id) ?? 0) + (bonusCaixa.get(id) ?? 0);
    const atual = n(j.diamonds);
    const delta = alvo - atual;
    if (alvo > 0) alvos.push({ nick: j.nick, alvo, atual });
    if (delta === 0) continue;
    await movimentarNaTransacao(
      cli, id, delta, MOTIVO.AJUSTE_ADMIN, 'reset_beta',
      `reset do fim do beta — saldo = ${fmt(comprado.get(id) ?? 0)} comprados`
      + `${bonusCaixa.get(id) ? ` + ${fmt(bonusCaixa.get(id))} de caixa aberta` : ''}`,
    );
    jogadoresAjustados++;
    if (delta > 0) creditados += delta; else debitados += -delta;
  }

  rel.diamantes = {
    jogadoresAjustados,
    creditados,
    debitados,
    jogadoresComSaldoFinal: alvos.length,
    totalFinal: alvos.reduce((s, a) => s + a.alvo, 0),
    maiores: alvos.sort((a, b) => b.alvo - a.alvo).slice(0, 15),
  };

  // ------------------------------------------------------- 6. tabelas que somem

  const zeradas = {};
  for (const t of TABELAS_ZERADAS) {
    const { rowCount } = await cli.query(`DELETE FROM ${t}`);
    zeradas[t] = rowCount;
  }
  rel.tabelasZeradas = zeradas;

  // ------------------------------------------------------------------- 7. depois

  const { rows: [depois] } = await cli.query(`
    SELECT (SELECT count(*)::int FROM players)                                        AS jogadores,
           (SELECT count(*)::int FROM accounts)                                       AS contas,
           (SELECT count(*)::int FROM player_pokemon)                                 AS pokemons,
           (SELECT count(*)::int FROM player_pokemon WHERE slot IS NOT NULL)          AS fora_do_depot,
           (SELECT coalesce(max(level),0)::int FROM player_pokemon)                   AS nivel_max,
           (SELECT count(*)::int FROM players WHERE level <> 1 OR xp <> 0)            AS nivel_sujo,
           (SELECT coalesce(sum(gold),0)::bigint FROM players)                        AS gold,
           (SELECT coalesce(sum(diamonds),0)::bigint FROM players)                    AS diamantes,
           (SELECT coalesce(sum(orbs),0)::bigint FROM players)                        AS gemas,
           (SELECT count(*)::int FROM caixas_beta)                                    AS caixas,
           (SELECT count(*)::int FROM players WHERE reset_starter)                    AS esperando_starter
  `);
  rel.depois = {
    jogadores: n(depois.jogadores), contas: n(depois.contas), pokemons: n(depois.pokemons),
    pokemonsForaDoDepot: n(depois.fora_do_depot), nivelMaximoDePokemon: n(depois.nivel_max),
    jogadoresComNivelNaoZerado: n(depois.nivel_sujo),
    gold: n(depois.gold), diamantes: n(depois.diamantes), gemas: n(depois.gemas),
    caixas: n(depois.caixas), esperandoStarter: n(depois.esperando_starter),
  };

  // As invariantes que o reset promete. Se uma delas falhar, a transação não é comitada —
  // é mais barato investigar com o banco intacto do que com meio reset gravado.
  const erros = [];
  if (rel.depois.contas !== rel.antes.contas) erros.push('contas foram perdidas');
  if (rel.depois.jogadores !== rel.antes.jogadores) erros.push('jogadores foram perdidos');
  if (rel.depois.pokemons !== rel.pokemons.mantidos) erros.push('sobrou pokémon que não é shiny nem P5');
  if (rel.depois.pokemonsForaDoDepot > 0) erros.push('há pokémon fora do Depot');
  if (rel.depois.nivelMaximoDePokemon > 100) erros.push('há pokémon acima do nível 100');
  if (rel.depois.jogadoresComNivelNaoZerado > 0) erros.push('há jogador com nível/xp não zerado');
  // A gema não é preservada: ela SOBE, exatamente pelo que estava parado na caixa postal do
  // Mercado. Qualquer outro número é bug — para mais, gema nasceu sem lastro; para menos,
  // alguém perdeu dinheiro com USDT por trás.
  const gemasEsperadas = rel.antes.gemas + rel.mercado.caixaPostal.gemasCreditadas;
  if (rel.depois.gemas !== gemasEsperadas) {
    erros.push(`gemas deveriam somar ${fmt(gemasEsperadas)} e somam ${fmt(rel.depois.gemas)}`);
  }
  // E o ledger tem de continuar batendo com o saldo, que é a regra da moeda com lastro.
  const { rows: [conf] } = await cli.query(`
    SELECT (SELECT coalesce(sum(orbs),0)::bigint FROM players)     AS saldo,
           (SELECT coalesce(sum(delta),0)::bigint FROM orb_ledger) AS ledger
  `);
  if (n(conf.saldo) !== n(conf.ledger)) {
    erros.push(`orb_ledger (${fmt(n(conf.ledger))}) não bate com players.orbs (${fmt(n(conf.saldo))})`);
  }
  rel.gemas = { saldo: n(conf.saldo), ledger: n(conf.ledger) };
  if (rel.depois.caixas !== rel.antes.caixas) erros.push('caixas_beta perdeu linhas');
  if (rel.depois.esperandoStarter !== rel.depois.jogadores) erros.push('nem todo jogador vai escolher starter');
  rel.erros = erros;

  if (erros.length) {
    await cli.query('ROLLBACK');
    console.error('\n✖ INVARIANTE QUEBRADA — nada foi gravado:\n  ' + erros.join('\n  '));
  } else if (DRY) {
    await cli.query('ROLLBACK');
  } else {
    // O carimbo entra na MESMA transação do reset: ou o mundo vira e a trava fecha juntos, ou
    // nenhum dos dois acontece. Carimbar depois, num INSERT à parte, deixaria a janela em que
    // o reset passou e a trava não — exatamente a janela em que alguém roda o script de novo
    // achando que a primeira vez falhou.
    await cli.query(
      `INSERT INTO game_meta (chave, valor) VALUES ('reset_beta_feito', $1)
         ON CONFLICT (chave) DO NOTHING`,
      [new Date().toISOString()],
    );
    await cli.query('COMMIT');
    commitou = true;
  }
} catch (err) {
  await cli.query('ROLLBACK').catch(() => {});
  console.error('\n✖ o reset falhou e nada foi gravado:', err.message);
  console.error(err.stack);
  cli.release();
  await pool.end();
  process.exit(1);
} finally {
  cli.release();
}

// ----------------------------------------------------------------- relatório

const seg = ((Date.now() - t0) / 1000).toFixed(1);
const L = (s = '') => console.log(s);

L();
L('═'.repeat(72));
L(`  RESET DO FIM DO BETA — ${DRY ? 'SIMULAÇÃO (nada gravado)' : commitou ? 'EXECUTADO' : 'ABORTADO'}`);
L('═'.repeat(72));

L();
L('  ANTES                              DEPOIS');
L(`  contas         ${fmt(rel.antes.contas).padStart(10)}       contas        ${fmt(rel.depois.contas).padStart(10)}`);
L(`  jogadores      ${fmt(rel.antes.jogadores).padStart(10)}       jogadores     ${fmt(rel.depois.jogadores).padStart(10)}`);
L(`  pokémon        ${fmt(rel.antes.pokemons).padStart(10)}       pokémon       ${fmt(rel.depois.pokemons).padStart(10)}`);
L(`  ouro           ${fmt(rel.antes.gold).padStart(10)}       ouro          ${fmt(rel.depois.gold).padStart(10)}`);
L(`  diamantes      ${fmt(rel.antes.diamantes).padStart(10)}       diamantes     ${fmt(rel.depois.diamantes).padStart(10)}`);
L(`  gemas          ${fmt(rel.antes.gemas).padStart(10)}       gemas         ${fmt(rel.depois.gemas).padStart(10)}  (+${fmt(rel.mercado.caixaPostal.gemasCreditadas)} da caixa postal)`);

L();
L('  POKÉMON');
L(`    apagados                       ${fmt(rel.pokemons.apagados).padStart(10)}`);
L(`    mantidos                       ${fmt(rel.pokemons.mantidos).padStart(10)}`);
L(`      só shiny                     ${fmt(rel.pokemons.soShiny).padStart(10)}`);
L(`      só P5                        ${fmt(rel.pokemons.soP5).padStart(10)}`);
L(`      shiny E P5                   ${fmt(rel.pokemons.shinyEP5).padStart(10)}`);
L(`    com refino preservado          ${fmt(rel.pokemons.comRefinoPreservado).padStart(10)}`);
L(`    com TM preservado              ${fmt(rel.pokemons.comTmPreservado).padStart(10)}`);
L(`    donos com pokémon no Depot     ${fmt(rel.pokemons.jogadoresComPokemon).padStart(10)}`);
L(`    nível máximo depois do reset   ${fmt(rel.depois.nivelMaximoDePokemon).padStart(10)}`);
if (rel.pokemons.subiramDeNivel) {
  L(`    ⚠ subiram de nível             ${fmt(rel.pokemons.subiramDeNivel).padStart(10)}  (estavam abaixo do nível de captura da espécie)`);
}
if (rel.pokemons.semEspecieNoCatalogo.length) {
  L(`    ⚠ espécie fora do catálogo     ${fmt(rel.pokemons.semEspecieNoCatalogo.length).padStart(10)}  (nível mantido como estava)`);
}

L();
L('  MERCADO DA COMUNIDADE');
L(`    anúncios abertos fechados      ${fmt(rel.mercado.anunciosAbertos).padStart(10)}`);
L(`      de pokémon (voltam ao Depot) ${fmt(rel.mercado.anunciosPokemon).padStart(10)}`);
L(`      de caixa (voltam à bolsa)    ${fmt(rel.mercado.anunciosCaixa).padStart(10)}`);
L(`      Casa Lendária devolvida      ${fmt(rel.mercado.casasLendariasDevolvidas).padStart(10)}`);
L(`      outros itens descartados     ${fmt(rel.mercado.anunciosItemDescartado).padStart(10)}`);
L(`    caixa postal: gema creditada   ${fmt(rel.mercado.caixaPostal.gemasCreditadas).padStart(10)}  em ${rel.mercado.caixaPostal.vendedoresCreditados} conta(s), ${rel.mercado.caixaPostal.linhasDeGema} venda(s)`);
L(`    caixa postal: ouro descartado  ${fmt(rel.mercado.caixaPostal.goldDescartado).padStart(10)}`);

L();
L('  CAIXAS DE FUNDADOR');
for (const [tipo, c] of Object.entries(rel.caixas.porTipo)) {
  L(`    ${tipo.padEnd(12)} abertas ${String(c.abertas).padStart(4)}   fechadas ${String(c.fechadas).padStart(4)}`);
}
L(`    diamantes devolvidos por caixa aberta   ${fmt(rel.caixas.diamantesDevolvidosPorCaixa).padStart(8)}  (${rel.caixas.jogadoresComCaixaAberta} jogador(es))`);

L();
L('  DIAMANTES  (total comprado + conteúdo das caixas abertas)');
L(`    jogadores ajustados            ${fmt(rel.diamantes.jogadoresAjustados).padStart(10)}`);
L(`    creditados                    +${fmt(rel.diamantes.creditados).padStart(10)}`);
L(`    debitados                     -${fmt(rel.diamantes.debitados).padStart(10)}`);
L(`    saldo final do servidor        ${fmt(rel.diamantes.totalFinal).padStart(10)}  em ${rel.diamantes.jogadoresComSaldoFinal} conta(s)`);
if (rel.diamantes.maiores.length) {
  L('    maiores saldos:');
  for (const m of rel.diamantes.maiores) {
    L(`      ${String(m.nick).padEnd(20)} ${fmt(m.alvo).padStart(8)} 💎   (tinha ${fmt(m.atual)})`);
  }
}

L();
L('  JOGADORES');
L(`    resetados                      ${fmt(rel.jogadores.resetados).padStart(10)}`);
L(`    com Casa Lendária na bolsa     ${fmt(rel.jogadores.comCasaLendaria).padStart(10)}`);
L(`    outfits removidas (skins)      ${fmt(rel.jogadores.outfitsRemovidas).padStart(10)}`);
L(`    looktype de volta ao padrão    ${fmt(rel.jogadores.looktypesVoltaramAoPadrao).padStart(10)}`);
L(`    vão escolher o inicial de novo ${fmt(rel.depois.esperandoStarter).padStart(10)}`);
L(`    ouro por conta                 ${fmt(GOLD_INICIAL).padStart(10)}`);

L();
L('  TABELAS ZERADAS');
for (const [t, q] of Object.entries(rel.tabelasZeradas)) L(`    ${t.padEnd(26)} ${fmt(q).padStart(8)} linha(s)`);

L();
if (rel.erros.length) {
  L(`  ✖ ABORTADO em ${seg}s — ${rel.erros.length} invariante(s) quebrada(s), nada foi gravado.`);
} else if (DRY) {
  L(`  ✔ simulação limpa em ${seg}s. Nada foi gravado (ROLLBACK).`);
  L('    Para valer: node tools/reset-beta.mjs --confirmar');
} else {
  L(`  ✔ reset gravado em ${seg}s.`);
  L('    Falta: BETA_OUTFITS_ABERTAS=0 no .env e reiniciar o servidor.');
}
L();

if (ARQUIVO_RELATORIO) {
  await writeFile(ARQUIVO_RELATORIO, JSON.stringify(rel, null, 2), 'utf8');
  console.log(`  relatório completo em ${ARQUIVO_RELATORIO}\n`);
}

await pool.end();
process.exit(rel.erros.length ? 1 : 0);
