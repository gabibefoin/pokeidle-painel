// Postgres com write-behind. O tick NUNCA espera o banco: a simulação marca o jogador como
// sujo e um timer despeja em lote. No disconnect faz flush imediato daquele jogador.
import pg from 'pg';
import { config } from './config.mjs';
import { empacotarVisual } from './game/visual.mjs';
import { compactarRefino } from '../shared/refino-stats.mjs';
import { XP_SHARE_HELD_ID } from '../shared/xp-share-held.mjs';
import { AVISO_VERSAO } from '../shared/aviso-jogo.mjs';
import {
  PVP_DECAIMENTO_MS,
  PVP_PARTIDAS_POSICIONAMENTO,
  rankComVaga,
  vagaDecaiu,
} from '../shared/pvp-rank.mjs';

// 25 conexões: o pool antigo (10) esgotava em pico de F5 — cada reconexão segura guild,
// ranking, moedas e carregarOuCriarJogador ao mesmo tempo, e a fila virava login de 3 min.
// `PG_POOL_MAX` baixa por processo quando muitos dividem o mesmo banco (ver `config.mjs`).
//
// O `application_name` diz de quem é cada conexão no `pg_stat_activity`: sem ele, com 16 processos
// na máquina, são centenas de linhas iguais vindas de 127.0.0.1 e nenhum jeito de saber qual sim
// está segurando o pool.
const nomeDoProcesso = config.role === 'sim'
  ? `pokeidle-sim-${config.shardId}`
  : config.role === 'gateway' ? `pokeidle-gateway-${config.porta}` : `pokeidle-${config.role}`;
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.pgPoolMax,
  application_name: nomeDoProcesso,
});

/**
 * O Postgres pode sumir por um instante, e isso NÃO pode derrubar o jogo.
 *
 * Sem este listener, o `pg` derrubava o processo inteiro. `Pool` é um EventEmitter, e um
 * EventEmitter que emite `'error'` sem ninguém escutando **lança** — o Node encerra com
 * `Unhandled 'error' event`. O erro não vem de uma query (essas já voltam para quem chamou, e
 * o `flush` sabe tratar): vem das conexões PARADAS no pool, que descobrem sozinhas que o outro
 * lado fechou.
 *
 * Visto em produção no deploy de 04/09: a troca das portas do compose recriou o container do
 * Postgres, e os três serviços morreram na hora com `terminating connection due to
 * administrator command`. Naquele dia foi inofensivo — eles iam ser reiniciados na linha
 * seguinte do `deploy.sh` de qualquer jeito. Mas a mesma linha de código transforma QUALQUER
 * soluço do banco (um OOM, uma rede que pisca, um `docker restart`) na queda de um shard
 * inteiro com centenas de jogadores, quando o certo é reconectar e seguir.
 *
 * Não há o que fazer aqui além de registrar: o `pg` já descarta a conexão ruim e abre outra na
 * próxima query. O log fica por conta de a queda ficar VISÍVEL — um banco que pisca de hora em
 * hora é sintoma, e sintoma silencioso não vira investigação.
 */
pool.on('error', (err) => {
  console.error('[db] conexão ociosa caiu (o pool reabre sozinha):', err.message);
});

/**
 * A TRAVA DE MIGRAÇÃO do cluster: as migrações de boot passam por ela um processo por vez.
 *
 * Num deploy os dez sims sobem no mesmo segundo, e cada um roda as mesmas migrações. DDL
 * concorrente no Postgres não fica segura só por dizer `IF NOT EXISTS`: dois `CREATE TABLE IF NOT
 * EXISTS` da mesma tabela nova podem estourar com `duplicate key` no catálogo, e um `DROP
 * CONSTRAINT` + `ADD CONSTRAINT` intercalado estoura com `already exists` — foi o que derrubou o
 * sim 4 e o sim 6 no boot, no deploy de 16/09/2026.
 *
 * É uma trava de SESSÃO (`pg_advisory_lock`) numa conexão reservada: as migrações em si seguem no
 * pool normal, e quem espera é o PRÓXIMO processo. Se este morrer no meio, o Postgres solta a
 * trava junto com a conexão. Devolve a função que a solta.
 *
 * A espera tem teto (`esperaMaxMs`): uma migração presa noutro processo não pode segurar o deploy
 * inteiro — passado o prazo, este migra sem a trava e avisa no log, que é como era antes dela.
 */
const CHAVE_MIGRACOES = `hashtext('pokeidle:migracoes')`;

export async function travarMigracoes(quem, esperaMaxMs = 90_000) {
  const inicio = Date.now();
  let cli;
  try {
    cli = await pool.connect();
    for (;;) {
      const { rows } = await cli.query(`SELECT pg_try_advisory_lock(${CHAVE_MIGRACOES}) AS ok`);
      if (rows[0].ok) break;
      if (Date.now() - inicio >= esperaMaxMs) {
        cli.release();
        console.warn(`[db] ${quem}: a trava de migração segue ocupada depois de ${Math.round(esperaMaxMs / 1000)} s — migrando sem ela`);
        return async () => {};
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (err) {
    cli?.release(err);
    console.warn(`[db] ${quem}: trava de migração indisponível (${err.message}) — migrando sem ela`);
    return async () => {};
  }
  const esperou = Date.now() - inicio;
  if (esperou >= 1000) console.log(`[db] ${quem}: esperou ${(esperou / 1000).toFixed(1)} s pela vez de migrar`);
  let solta = false;
  return async () => {
    if (solta) return;
    solta = true;
    try {
      await cli.query(`SELECT pg_advisory_unlock(${CHAVE_MIGRACOES})`);
      cli.release();
    } catch (err) {
      // Conexão destruída em vez de devolvida: a trava de sessão vai embora com ela.
      cli.release(err);
    }
  };
}

export async function aguardarBanco(tentativas = 30) {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i >= tentativas) throw new Error(`Postgres não respondeu: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/**
 * Migrações idempotentes.
 *
 * O `schema.sql` só roda na PRIMEIRA subida do Postgres (docker-entrypoint-initdb.d), então
 * banco que já existe nunca veria uma coluna nova. Rodar isto no boot mantém os dois casos
 * iguais sem precisar de ferramenta de migração.
 */
export async function migrar() {
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS diamonds BIGINT NOT NULL DEFAULT 0`);
  // As três da PESCA. O modo saiu do jogo e nada mais lê nem escreve nelas — ficam porque
  // `fishing_skill` é o COMPROVANTE do ressarcimento (1 💎 por nível, pago uma vez por
  // `ressarcirPesca` em `diamantes-db.mjs`), e dropar a coluna apagaria a prova de quanto
  // cada conta tinha no dia em que a Pesca foi retirada. Podem ser dropadas quando alguém
  // mexer no schema e o ledger já estiver conferido.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS fishing_skill INT  NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS fishing_fish  REAL NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS fishing_tier  INT  NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS boss_points   INT  NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS elo              INT    NOT NULL DEFAULT 1000`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_abates       INT    NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_mortes       INT    NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_cooldown_ate BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE player_pokemon ADD COLUMN IF NOT EXISTS power INT NOT NULL DEFAULT 0`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pp_power ON player_pokemon(power DESC)`);
  // A POTÊNCIA (1 a 5) sorteada na captura. O DEFAULT é 0 e não 1 de propósito: 0 significa
  // "ainda não passou pela roleta" e é o que o backfill do boot procura, do mesmo jeito que
  // `power = 0` faz para o ranking. Fosse 1, todo pokémon anterior a esta versão ficaria com
  // a potência mais fraca para sempre, sem nunca ter tido a chance de rolar.
  await pool.query(`ALTER TABLE player_pokemon ADD COLUMN IF NOT EXISTS potencia SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE player_pokemon ADD COLUMN IF NOT EXISTS tm_elemental VARCHAR(16)`);
  // O REFINO: `{ hp, atk, def, spAtk, spDef }`, quantos "+1" já foram comprados em cada
  // stat-base. `{}` é o pokémon que nunca foi refinado — a esmagadora maioria — e ler jsonb
  // vazio custa o mesmo que ler um NULL, então não vale uma coluna por stat. Ver
  // `shared/refino-stats.mjs` para a regra e `pokemon.refinar` em `sim.mjs` para a compra.
  await pool.query(`ALTER TABLE player_pokemon ADD COLUMN IF NOT EXISTS bonus_base JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE player_pokemon ADD COLUMN IF NOT EXISTS tm_aoe BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE player_pokemon ADD COLUMN IF NOT EXISTS held_item_id INT`);
  // Ranking de PvP: mesma ideia do índice de nível — a aba ordena por ELO e não pode escanear
  // a tabela inteira. Só quem já lutou entra (ELO exatamente inicial = nunca pisou na arena).
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_elo ON players(elo DESC)`);
  // Ranking de Coins: ordena por ouro acumulado.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_gold ON players(gold DESC)`);
  // Loja VIP. Tudo jsonb ou escalar pequeno — um jogador continua cabendo numa linha só.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS vip_ate     BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS boosts      JSONB  NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS boosts_hoje JSONB  NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS bless       TEXT`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS compras_cooldown JSONB NOT NULL DEFAULT '{}'::jsonb`);
  // O PASSE DE BATALHA (ver `game/passe-batalha.mjs`): o degrau, o último resgate e o prazo do VIP.
  // Mora na linha do jogador para ir no MESMO flush dos prêmios que o resgate entrega.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS passe JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gender      TEXT   NOT NULL DEFAULT 'male'`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS looktype    INT    NOT NULL DEFAULT 159`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS owned_outfits JSONB NOT NULL DEFAULT '[]'::jsonb`);
  // As cores do outfit, escolhidas no onboarding: as quatro regiões da máscara `_template`
  // (cabeça, tronco, pernas, pés), cada uma um índice da paleta de 133 do Tibia. Ver
  // `src/client/cores-outfit.mjs`. Quatro números que mudam juntos: cabem num jsonb.
  //
  // `visual_ok` é o que TRANCA a customização depois do onboarding: a partir dele, trocar de
  // visual só comprando skin na loja. Sem a trava, `visual.set` continuaria valendo para
  // sempre e a skin paga não valeria nada.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS visual    JSONB   NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS visual_ok BOOLEAN NOT NULL DEFAULT false`);
  // Quando o jogador trocou de avatar pela última vez (o botão "Mudar avatar" da ficha).
  // Carimbo em ms, 0 = nunca trocou. Fica FORA do flush de propósito — ver `registrarTrocaDeVisual`.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS visual_trocado_em BIGINT NOT NULL DEFAULT 0`);
  // DEFAULT true = quem já jogava não vê o tutorial de novo. Contas novas entram com false
  // explícito no INSERT.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS tutorial_visto BOOLEAN NOT NULL DEFAULT true`);
  // Quantos Fragmentos de Chave esta CONTA já obteve na vida (drop + loja). Contador que só
  // cresce, à parte do saldo em `items`.
  //
  // NÃO há mais teto por conta — já houve um de 10 (a coluna nasceu para ele), removido depois:
  // Fragmento de Chave cai livre na Outland. Hoje a coluna é só um número histórico, sem nenhuma
  // regra pendurada nele; pode ser dropada quando alguém quiser mexer no schema.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS frag_chave_total INT NOT NULL DEFAULT 0`);
  // Em qual OUTLAND o jogador está caçando — o número do degrau na escada.
  //
  // Coluna própria, e não `automation`: é o degrau de uma
  // ESCADA de conteúdo, gravado porque quem chegou à Outland 5 no nível 4.000 não deve
  // reencontrar a 1 no login seguinte. O conteúdo de todas é o mesmo — o que o degrau muda é
  // a chance dos três drops raros da área. SMALLINT porque só o NÚMERO do degrau mora aqui:
  // nível e multiplicador vêm de `shared/outland-tiers.mjs`, então rebalancear a escada — ou
  // acrescentar mais uma Outland no fim dela — nunca pede migração.
  //
  // DEFAULT 1 = quem já jogava continua exatamente onde estava, com as chances de sempre.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS outland_tier SMALLINT NOT NULL DEFAULT 1`);
  // Os postos de XP SHARE da Casa: `[pokemonId | null, ...]`, um por boneco (ver a seção
  // XP SHARE em `sim.mjs`). Coluna própria e não `automation` porque não é automação — é uma
  // ESCALAÇÃO, e ela precisa sobreviver ao logout pelo mesmo motivo que a equipe sobrevive:
  // refazer a cada login é atrito, não jogo. Id que não vale mais é limpo na leitura, então a
  // coluna nunca precisa de manutenção.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS xp_share JSONB NOT NULL DEFAULT '[]'::jsonb`);
  // Quantas Exp. Share esta conta tem DIREITO a ter — o número contra o qual a bolsa e os
  // `held_item_id` são conferidos em todo login (ver `conferirXpShareHeld` em `sim.mjs`).
  //
  // A coluna existe porque a alternativa é reconstruir o direito pelo ledger toda vez, e isso
  // é uma agregação em `diamante_ledger` por jogador — barata sozinha, cara 5.800 vezes. Aqui
  // ela é um inteiro que já vem na MESMA linha que a bolsa: a conferência do login sai de
  // graça, sem uma consulta a mais.
  //
  // Só a Loja incrementa (50 💎, 1 unidade). Não decrementa: a Exp. Share não vende ao NPC,
  // não se destrói e — desde que saiu da vitrine — não muda de dono. Ver `xp-share-held.mjs`.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS xp_share_total INT NOT NULL DEFAULT 0`);
  // Pop-up do Discord: última campanha que o jogador dispensou ("não mostrar novamente").
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS discord_pop_dispensado BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS discord_pop_campanha INTEGER NOT NULL DEFAULT 0`);
  // O último AVISO DE MUDANÇA que o jogador fechou (ver `shared/aviso-jogo.mjs`). DEFAULT 0
  // de propósito: quem já tem conta nunca viu aviso nenhum, então o primeiro alcança todo
  // mundo. Conta NOVA nasce com o número de agora — ver o `INSERT INTO players` mais abaixo.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS aviso_visto INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS perfil_stats_publico BOOLEAN NOT NULL DEFAULT true`);
  // A VITRINE da Ficha do Treinador: `[pokemonId, ...]`, os bichos que o jogador escolheu
  // exibir. Coluna própria pelo mesmo motivo do `xp_share` — é uma ESCALAÇÃO, não automação,
  // e refazê-la a cada login seria atrito puro. Vazia = a tela cai na equipe atual, então
  // ninguém precisa montar vitrine para ter uma. Id que já não é do dono é limpo na leitura.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS vitrine JSONB NOT NULL DEFAULT '[]'::jsonb`);
  // "Este jogador ainda precisa escolher o inicial" — ligada em massa pelo reset do fim do beta
  // (`tools/reset-beta.mjs`) e desligada no `starter.pick`.
  //
  // A coluna existe porque a pergunta "já escolheu?" era respondida por `p.pokemons.size === 0`,
  // e o reset quebra essa equivalência: quem atravessou com um shiny no Depot TEM pokémon e
  // mesmo assim nunca escolheu inicial nenhum neste mundo. Sem a coluna, exatamente as contas
  // que mais jogaram o beta seriam as únicas a entrar no lançamento sem starter, sem kit e sem
  // ninguém em campo.
  //
  // Fica FORA do write-behind, como `visual_trocado_em`: é gravada na hora, por
  // `limparResetStarter`, porque um flush perdido devolveria a tela de escolha a quem já
  // escolheu — e um segundo starter de graça junto com ela.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS reset_starter BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`
    UPDATE players SET discord_pop_campanha = 1
    WHERE discord_pop_dispensado = true AND discord_pop_campanha = 0
  `);
  // O starter escolhido no onboarding (Bulbasaur/Charmander/Squirtle) nasce nv 5 com treinador nv 1.
  // Só ESSA instância ignora a regra de nível do treinador (folga de 5). O flag vem do INSERT
  // em `criarPokemon(..., ehStarter=true)` — não se adivinha por captura posterior.
  await pool.query(`ALTER TABLE player_pokemon ADD COLUMN IF NOT EXISTS starter BOOLEAN NOT NULL DEFAULT false`);
  // A data de NASCIMENTO do bicho: quando foi capturado, e não quando trocou de dono. Ela já
  // vive no `sql/schema.sql` desde o primeiro dia — esta linha existe só para um banco que
  // tenha nascido sem ele, e por isso repete a forma de lá EXATAMENTE. Declarada anulável e
  // sem default (como estava) ela não quebrava produção, onde a coluna já existe e o
  // `IF NOT EXISTS` não faz nada — mas descrevia uma coluna que não é essa, e num banco novo
  // daria data nula em toda captura, com o "Capturado em" sumindo da ficha para sempre.
  //
  // Não há INSERT que preencha a coluna: quem data é o `DEFAULT now()`, no instante em que a
  // linha nasce — que é a captura. A venda no Mercado é `UPDATE ... SET player_id`
  // (`market-db.mjs`), então id e data atravessam a troca de dono; evolução também é UPDATE.
  // Não existe caminho em que a data vire a da venda.
  await pool.query(`ALTER TABLE player_pokemon ADD COLUMN IF NOT EXISTS caught_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  // Limpa falsos positivos de um backfill antigo que marcava o primeiro 1/4/7 capturado.
  // O onboarding nasce potência 2 e nunca shiny; capturas não são starter.
  await pool.query(`
    UPDATE player_pokemon SET starter = false
    WHERE starter = true
      AND (shiny = true OR potencia < 2)
  `);
  await pool.query(`CREATE TABLE IF NOT EXISTS game_meta (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  )`);
  await backfillXpShareTotal();
  // Outland: pokeId espelho 10501+ → #2001+ (v1.39). Idempotente via game_meta.
  const migOutland = await pool.query(
    `SELECT valor FROM game_meta WHERE chave = 'outland_pokeid_v2001'`,
  );
  if (!migOutland.rows.length) {
    await pool.query(`
      UPDATE player_pokemon
      SET species_id = species_id - 8500
      WHERE species_id >= 10501 AND species_id < 10548
    `);
    // Chaves de Pokédex salvas como pokeId legado (10501+) → #2001+.
    await pool.query(`
      UPDATE players
      SET pokedex = (
        SELECT COALESCE(jsonb_object_agg(
          CASE
            WHEN (k)::int >= 10501 AND (k)::int < 10548 THEN ((k)::int - 8500)::text
            ELSE k
          END,
          v
        ), '{}'::jsonb)
        FROM jsonb_each(pokedex) AS t(k, v)
      )
      WHERE EXISTS (
        SELECT 1 FROM jsonb_each(pokedex) AS t(k, v)
        WHERE (k)::int >= 10501 AND (k)::int < 10548
      )
    `);
    await pool.query(
      `INSERT INTO game_meta (chave, valor) VALUES ('outland_pokeid_v2001', '1')`,
    );
  }
}

/**
 * Liga "Usar Revive", "Usar Poções" e "Voltar à hunt" em TODA conta que já existe. Uma vez.
 *
 * As três passaram a nascer ligadas (ver `carregarJogador` em `sim.mjs`), mas o padrão só
 * alcança conta nova: quem já jogou tem as chaves gravadas em `players.automation` com o
 * `false` de antes, e o `...(jogador.automation)` da carga passa por cima de qualquer padrão
 * novo — como tem de passar, senão desligar uma automação nunca duraria mais que um restart.
 * Por isso a virada é um UPDATE, e não um padrão mais esperto.
 *
 * ### Uma vez, e o que isso protege
 *
 * O carimbo em `game_meta` é o que separa "ligar para todo mundo no deploy" de "religar para
 * todo mundo a cada restart". Sem ele, quem desligasse a auto-poção de propósito — para poupar
 * a Golden Potion, por exemplo — a veria de volta na próxima subida do servidor, gastando o
 * item enquanto ninguém olha. A decisão de quem já mexeu no painel vale a partir do deploy.
 *
 * ### O que a virada NAO toca
 *
 * A lista de itens de quem já escolheu algum. O `potionIds` só recebe o padrão quando está
 * vazio ou ausente: quem marcou "gasta as Small primeiro" continua com a ordem dele. E o
 * `jsonb_typeof` antes do `jsonb_array_length` é porque a segunda estoura em valor que não é
 * array — uma linha torta derrubaria a migração e, com ela, o boot do sim.
 *
 * Roda dentro da trava de migrações do sim (`travarMigracoes`), então os dez processos do
 * cluster não disputam o mesmo UPDATE.
 *
 * @param {{potionIds: number[], reviveIds: number[]}} padrao ids vindos do catálogo (`sim.mjs`)
 */
export async function ligarAutoCuidadoDeTodos({ potionIds = [], reviveIds = [] } = {}) {
  const feito = await pool.query(`SELECT 1 FROM game_meta WHERE chave = 'auto_cuidado_ligado_v1'`);
  if (feito.rows.length) return 0;

  const { rowCount } = await pool.query(
    `UPDATE players SET automation =
       COALESCE(automation, '{}'::jsonb)
       || jsonb_build_object('autoRevive', true, 'autoPotion', true, 'autoVoltarHunt', true)
       || CASE WHEN jsonb_typeof(automation->'potionIds') = 'array'
                    AND jsonb_array_length(automation->'potionIds') > 0
               THEN '{}'::jsonb ELSE jsonb_build_object('potionIds', $1::jsonb) END
       || CASE WHEN jsonb_typeof(automation->'reviveIds') = 'array'
                    AND jsonb_array_length(automation->'reviveIds') > 0
               THEN '{}'::jsonb ELSE jsonb_build_object('reviveIds', $2::jsonb) END`,
    [JSON.stringify(potionIds), JSON.stringify(reviveIds)],
  );

  await pool.query(
    `INSERT INTO game_meta (chave, valor) VALUES ('auto_cuidado_ligado_v1', '1')
       ON CONFLICT (chave) DO NOTHING`,
  );
  console.log(`[db] auto-cuidado (revive, poção, voltar à hunt) ligado em ${rowCount} conta(s).`);
  return rowCount;
}

/**
 * Jogadores com mais de cinco pokémon na equipe — legado do limite antigo (slot 5), captura
 * concorrente que duplicou slot, ou buraco preenchido sem contar o tamanho do time.
 *
 * Mantém os cinco primeiros (menor slot, depois menor id) e manda o resto pro Depot. Slots
 * repetidos no mesmo jogador também voltam pro Depot (fica o de menor id). Roda no boot.
 */
export async function corrigirEquipesExcedentes(maxEquipe = 5) {
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');

    // Slot ≥ maxEquipe é legado (schema antigo dizia 0..5). Não conta como lugar válido.
    const { rows: invalidos } = await cli.query(
      `UPDATE player_pokemon SET slot = NULL
        WHERE slot >= $1 AND anuncio_id IS NULL
        RETURNING id, player_id`,
      [maxEquipe],
    );

    // Dois bichos no mesmo slot (corrida de captura): o mais antigo fica, o outro vai pro Depot.
    // ANTES de cortar excesso — senão o 6º some e depois o duplicado some de novo (6 → 4).
    const { rows: duplicados } = await cli.query(
      `WITH dup AS (
         SELECT id, player_id,
                ROW_NUMBER() OVER (PARTITION BY player_id, slot ORDER BY id ASC) AS rn
           FROM player_pokemon
          WHERE slot IS NOT NULL AND anuncio_id IS NULL
       )
       UPDATE player_pokemon pp SET slot = NULL
         FROM dup d
        WHERE pp.id = d.id AND d.rn > 1
        RETURNING pp.id, pp.player_id`,
    );

    const { rows: excesso } = await cli.query(
      `WITH equipe AS (
         SELECT id, player_id,
                ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY slot ASC, id ASC) AS pos,
                COUNT(*) OVER (PARTITION BY player_id) AS cnt
           FROM player_pokemon
          WHERE slot IS NOT NULL AND anuncio_id IS NULL
       )
       UPDATE player_pokemon pp SET slot = NULL
         FROM equipe e
        WHERE pp.id = e.id AND e.cnt > $1 AND e.pos > $1
        RETURNING pp.id, pp.player_id`,
      [maxEquipe],
    );

    const movidos = [...invalidos, ...duplicados, ...excesso];
    const idsMovidos = [...new Set(movidos.map((r) => Number(r.id)))];

    if (idsMovidos.length) {
      await cli.query(
        `UPDATE players p
            SET active_poke = (
              SELECT pp.id FROM player_pokemon pp
               WHERE pp.player_id = p.id AND pp.slot IS NOT NULL AND pp.anuncio_id IS NULL
               ORDER BY pp.slot ASC, pp.id ASC
               LIMIT 1
            )
          WHERE p.active_poke = ANY($1::bigint[])`,
        [idsMovidos],
      );
    }

    await cli.query('COMMIT');

    if (!movidos.length) return { movidos: 0, jogadores: [] };

    const playerIds = [...new Set(movidos.map((r) => Number(r.player_id)))];
    const { rows: jogadores } = await pool.query(
      `SELECT id, nick FROM players WHERE id = ANY($1::bigint[]) ORDER BY nick`,
      [playerIds],
    );
    return { movidos: idsMovidos.length, jogadores };
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}

/**
 * Preenche `players.xp_share_total` UMA vez, com o direito histórico de cada conta.
 *
 * Daqui em diante só a Loja incrementa a coluna. Mas o histórico não é só a Loja: enquanto a
 * Exp. Share foi negociável (28/08 a hoje) ela mudou de dono no Mercado, e quem comprou de
 * outro jogador não tem linha no `diamante_ledger`. Sem as duas pontas do Mercado nesta conta,
 * a conferência do login apagaria o item de quem pagou por ele na vitrine.
 *
 * `estado = 'vendido'` é a única transferência que conta: `cancelado` e `expirado` devolvem ao
 * próprio vendedor (o item nunca saiu da conta) e `aberto` é escrow — ainda é dele.
 *
 * Idempotente via `game_meta`: roda no primeiro boot que encontrar a coluna vazia e nunca mais.
 * Fosse recalculada a cada subida, uma compra feita entre o boot e o flush seguinte seria
 * sobrescrita e o jogador perderia 50 💎.
 */
async function backfillXpShareTotal() {
  const feito = await pool.query(`SELECT 1 FROM game_meta WHERE chave = 'xp_share_total_backfill'`);
  if (feito.rows.length) return;

  // As duas tabelas do histórico nascem em OUTROS módulos (`diamantes-db.mjs`, `market-db.mjs`),
  // e o `migrar()` deles roda depois deste. Num banco novo elas ainda não existem — e aí não há
  // histórico nenhum para preencher. Sai sem carimbar o `game_meta`: no boot seguinte as tabelas
  // já estão de pé e, se houver o que ler, este backfill lê.
  const { rows: [tabelas] } = await pool.query(
    `SELECT to_regclass('diamante_ledger') AS ledger, to_regclass('market_anuncios') AS mercado`,
  );
  if (!tabelas.ledger || !tabelas.mercado) return;

  // `d.n > p.xp_share_total` e não `d.n > 0`: assim este UPDATE só sabe SUBIR o direito.
  // Rodar de novo — por um `game_meta` perdido num restore, por exemplo — nunca pode baixar a
  // coluna, porque baixar significa apagar item de jogador na conferência do login seguinte.
  const { rowCount } = await pool.query(`
    WITH direito AS (
      SELECT p.id AS player_id,
             (SELECT COUNT(*) FROM diamante_ledger d
               WHERE d.player_id = p.id AND d.motivo = 'loja' AND d.ref = 'xpshareheld')
           + COALESCE((SELECT SUM(a.qtd) FROM market_anuncios a
                        WHERE a.comprador_id = p.id AND a.tipo = 'item'
                          AND a.item_id = $1 AND a.estado = 'vendido'), 0)
           - COALESCE((SELECT SUM(a.qtd) FROM market_anuncios a
                        WHERE a.vendedor_id = p.id AND a.tipo = 'item'
                          AND a.item_id = $1 AND a.estado = 'vendido'), 0) AS n
        FROM players p
    )
    UPDATE players p SET xp_share_total = GREATEST(0, d.n)::int
      FROM direito d WHERE d.player_id = p.id AND d.n > p.xp_share_total`,
    [XP_SHARE_HELD_ID],
  );

  await pool.query(
    `INSERT INTO game_meta (chave, valor) VALUES ('xp_share_total_backfill', '1')
       ON CONFLICT (chave) DO NOTHING`,
  );
  console.log(`[db] xp_share_total preenchido em ${rowCount} conta(s).`);
}

/** Cria (ou recupera) o jogador pelo nick e devolve o estado completo. */
export async function carregarOuCriarJogador(nick) {
  const existente = await pool.query(`SELECT * FROM players WHERE lower(nick) = lower($1)`, [nick]);
  let p;
  if (!existente.rows[0]) {
    const ins = await pool.query(
      // `aviso_visto` já entra no valor de HOJE: o aviso de mudança é recado para quem
      // usava o que mudou, e quem está criando a conta agora não usava nada.
      `INSERT INTO players (nick, tutorial_visto, aviso_visto) VALUES ($1, false, $2) RETURNING *`,
      [nick, AVISO_VERSAO],
    );
    p = ins.rows[0];
  } else {
    p = existente.rows[0];
  }
  // `anuncio_id IS NULL` é o escrow do Mercado Global: pokémon na vitrine sai da mão do
  // dono, senão ele o venderia ao NPC e o comprador receberia um id que não existe mais.
  // A coluna pode não existir ainda na primeira subida — `COALESCE` sobre uma coluna
  // ausente estouraria, então a migração de `market-db.mjs` roda antes de qualquer login.
  //
  // A coleção e o `last_seen` saem JUNTOS: um não lê o outro, e numa leva de logins (deploy, queda
  // de operadora) cada ida ao banco em sequência é mais uma espera na fila do pool.
  //
  // Os ids ANUNCIADOS vêm junto porque a Coleção é uma lista de ids em `automation`, e o login
  // é onde ela se limpa (`limparColecao` no sim): pokémon vendido, oferendado ou comprado por
  // outro deixa o id para trás. O que está na vitrine não está em `pokes`, mas continua do
  // jogador — sem esta lista, cancelar o anúncio o devolveria ao Depot em vez da Coleção. Se a
  // leitura falhar, `null`: a limpeza é pulada e o login segue.
  const [{ rows: pokes }, , anunciados] = await Promise.all([
    pool.query(
      `SELECT * FROM player_pokemon WHERE player_id = $1 AND anuncio_id IS NULL
        ORDER BY slot NULLS LAST, id`,
      [p.id],
    ),
    existente.rows[0] ? pool.query(`UPDATE players SET last_seen = now() WHERE id = $1`, [p.id]) : null,
    existente.rows[0]
      ? pool.query(
        `SELECT id FROM player_pokemon WHERE player_id = $1 AND anuncio_id IS NOT NULL`,
        [p.id],
      ).then((r) => r.rows.map((x) => Number(x.id))).catch(() => null)
      : [],
  ]);
  return { jogador: p, pokemons: pokes, anunciados };
}

/**
 * Troca o nick (produto "Troca de Nome" da loja).
 *
 * Estoura quando o nome já existe — o `nick` é UNIQUE. Quem chamou trata o erro devolvendo
 * os diamantes: entre a validação e este UPDATE outro jogador pode ter pegado o nome, e
 * cobrar por essa corrida seria cobrar do jogador um erro que não é dele.
 *
 * O nick também é a CHAVE DE ROTEAMENTO do socket (e, por ela, do shard). Quem continua
 * conectado seguiria pela chave antiga — por isso o sim derruba a sessão logo depois desta
 * gravação, em `reabrirSessaoComNomeNovo`: só um `hello` novo recalcula chave e shard. O
 * `hello` usa `accounts.nick`, e o cliente recebe token novo no evento.
 */
export async function renomearJogador(id, nick, contaId = null) {
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    const { rows } = await cli.query(`SELECT nick FROM players WHERE id = $1`, [id]);
    if (!rows[0]) throw new Error('jogador não encontrado');
    const antigo = rows[0].nick;
    await cli.query(`UPDATE players SET nick = $2 WHERE id = $1`, [id, nick]);
    // `accounts.nick` é a ponte conta ↔ personagem; sem isto o token e o hello continuam
    // apontando pro nick velho e o refresh cria um player vazio com o nome antigo.
    //
    // Pelo ID quando quem chama sabe de quem é a conta (os dois caminhos de troca sabem), e
    // não pelo nick: casar por nick aqui é casar justamente pelo campo que está mudando, num
    // banco onde ele é reaproveitável. Basta `players` e `accounts` terem saído de sincronia
    // uma vez — um flush que falhou, um conserto à mão — para este UPDATE renomear a conta
    // de OUTRO jogador, que é o pior estrago possível: ela passa a apontar para um
    // personagem que não é dela.
    if (contaId != null) {
      await cli.query(`UPDATE accounts SET nick = $2 WHERE id = $1`, [contaId, nick]);
    } else {
      await cli.query(
        `UPDATE accounts SET nick = $2 WHERE lower(nick) = lower($1)`,
        [antigo, nick],
      );
    }
    await cli.query('COMMIT');
  } catch (err) {
    await cli.query('ROLLBACK');
    throw err;
  } finally {
    cli.release();
  }
}

/**
 * Carimba a troca de avatar. **Escrita direta, fora do write-behind** — e não é descuido.
 *
 * `flushJogadores` grava a partir da memória a cada 5 s; uma trava de 24 h que só chegasse ao
 * banco no flush seguinte seria contornável fechando o jogo depois de trocar. Aqui a espera
 * começa a valer no instante do clique, e sobrevive a um crash do processo.
 */
export async function registrarTrocaDeVisual(playerId, quando) {
  await pool.query(`UPDATE players SET visual_trocado_em = $2 WHERE id = $1`, [playerId, quando]);
}

/**
 * Baixa a bandeira de "precisa escolher o inicial", assim que o starter existe de verdade.
 *
 * Fora do write-behind pela mesma razão de `registrarTrocaDeVisual`: entre o `starter.pick` e
 * o flush seguinte há segundos, e um processo que caia nessa janela devolveria a tela de
 * escolha a quem já escolheu — com um segundo starter de graça no fim dela.
 */
export async function limparResetStarter(playerId) {
  await pool.query(`UPDATE players SET reset_starter = false WHERE id = $1`, [playerId]);
}

export async function inserirPokemon(playerId, poke) {
  const { rows } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, xp, quality, ivs, hp, shiny, slot, power, potencia, starter)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, caught_at`,
    [playerId, poke.speciesId, poke.level, poke.xp, poke.quality, poke.ivs, poke.hp, poke.shiny, poke.slot,
     poke.power ?? 0, poke.potencia ?? 1, !!poke.starter],
  );
  return rows[0];
}

/** Apaga pokémon vendidos. Fora do caminho crítico: a simulação já os tirou da memória. */
/**
 * Uma linha de `player_pokemon` pelo id, conferindo o dono.
 *
 * Serve ao Mercado Global: depois que a transação de compra/cancelamento muda o banco, o
 * sim precisa trazer ESSE pokémon para a memória sem recarregar o jogador inteiro.
 */
export async function pokemonPorId(id, playerId) {
  const { rows } = await pool.query(
    `SELECT * FROM player_pokemon WHERE id = $1 AND player_id = $2 AND anuncio_id IS NULL`,
    [id, playerId],
  );
  return rows[0] ?? null;
}

/**
 * Apaga pokémon de UM jogador — todos ou nenhum.
 *
 * Quem chama (oferenda, venda ao NPC) paga pelo que apagou: pedra ou ouro. Por isso o `DELETE`
 * confere o que a memória do sim não tem como garantir sozinha:
 *
 *   · **o DONO** (`player_id`). Uma memória desatualizada — a linha foi vendida no Mercado e
 *     já é de outra conta — não pode apagar o pokémon de ninguém;
 *   · **o ESCROW** (`anuncio_id IS NULL`). O que está à venda no Mercado continua na tabela, e
 *     apagá-lo daria ao vendedor a pedra agora e o ouro depois;
 *   · **a CONTAGEM.** Um `DELETE` que casa com menos linhas não dá erro nenhum no Postgres — e
 *     o chamador pagaria por um pokémon que já não existia. Faltou uma, a transação volta
 *     inteira, e o erro leva em `fora` os ids que o banco não entregou.
 */
export async function removerPokemons(ids, playerId) {
  if (!ids.length) return;
  const esperados = [...new Set(ids.map(Number))];
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `DELETE FROM player_pokemon
        WHERE id = ANY($1::bigint[]) AND player_id = $2 AND anuncio_id IS NULL
        RETURNING id`,
      [esperados, playerId],
    );
    if (rows.length !== esperados.length) {
      await c.query('ROLLBACK');
      const apagados = new Set(rows.map((r) => Number(r.id)));
      const err = new Error(`removerPokemons: só ${rows.length} de ${esperados.length} linhas eram apagáveis`);
      err.fora = esperados.filter((id) => !apagados.has(id));
      throw err;
    }
    await c.query('COMMIT');
  } catch (err) {
    if (!err.fora) await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

// `power` acompanha o nível: sobe junto no `recalcular` e é o que o ranking ordena.
//
// `COALESCE` no refino é rede de segurança, não elegância: se um dia algum caminho montar um
// pokémon sem `refino`, gravar `{}` por cima apagaria dezenas de milhares de pedras que o
// jogador pagou, e não há como devolver. `null` aqui quer dizer "não sei, mantenha o que está
// no banco". Ver `shared/refino-stats.mjs`.
const SQL_POKEMON = `UPDATE player_pokemon SET level=$2, xp=$3, hp=$4, slot=$5, power=$6, species_id=$7,
                            tm_elemental=$8, tm_aoe=$9,
                            held_item_id=$10,
                            bonus_base=COALESCE($11::jsonb, bonus_base) WHERE id=$1`;

/**
 * Congela um pokémon vivo na LISTA DE PARÂMETROS que a gravação vai usar.
 *
 * O retorno é o array de `$1..$11`, e isso é o ponto — não é um detalhe de estilo. Enquanto
 * `gravarPokemonEm` recebia o objeto vivo, ela lia `k.heldItemId` lá na frente, DENTRO da
 * transação, enquanto `players.items` já tinha sido congelado em JSON pelo `flush()` lá atrás.
 * As duas metades da Exp. Share (a bolsa e o `held_item_id`) saíam de instantes diferentes,
 * separados pela transação inteira — medida em ~1 s com 250 jogadores no lote. Equipar dentro
 * dessa janela gravava "a bolsa ainda tem" junto com "o pokémon já segura", e um virava dois no
 * primeiro login seguinte.
 *
 * Reduzindo o pokémon a valores AQUI, no mesmo instante síncrono em que o inventário vira
 * texto, não sobra nada vivo para a transação reler. E como a query só recebe o array, não há
 * como um campo novo escapar do congelamento por esquecimento: quem quiser gravar mais uma
 * coluna tem de acrescentá-la nesta função.
 */
export function congelarPokemon(k) {
  return [k.id, k.level, k.xp, k.hp, k.slot, k.poder, k.speciesId, k.tmElemental ?? null, !!k.tmAoe,
    k.heldItemId ?? null,
    k.refino ? JSON.stringify(compactarRefino(k.refino)) : null];
}

/**
 * Grava UMA linha de `player_pokemon` a partir de valores JÁ congelados (ver `congelarPokemon`).
 * É o corpo que o flush repete por pokémon sujo, e também o que `gravarPokemon` usa fora dele.
 */
function gravarPokemonEm(cli, valores) {
  return cli.query(SQL_POKEMON, valores);
}

/**
 * Grava um pokémon AGORA, fora do ciclo de flush.
 *
 * Existe para quem tira um pokémon de `p.pokemons` deixando a LINHA de pé — hoje só o escrow
 * do Mercado. Assim que ele sai da memória o flush não tem mais como encontrá-lo (ver o
 * `.filter(Boolean)` do payload em `sim.mjs`), e tudo que estivesse pendente ali seria
 * descartado em silêncio: a Exp. Share desequipada segundos antes continuava gravada na linha,
 * o item voltava para a bolsa, e um virava dois. O mesmo valia para um refino ou um TM
 * aplicado na janela — só que ali o jogador PERDIA as pedras.
 */
export async function gravarPokemon(pk) {
  await gravarPokemonEm(pool, congelarPokemon(pk));
}

/**
 * Despeja um lote de jogadores sujos. Uma transação por lote, uma query por jogador —
 * o jsonb faz o inventário inteiro caber numa linha, então não há N+1 aqui.
 *
 * TUDO que esta função grava já chegou congelado do `flush()` do sim: `items`/`automation`/… como
 * texto JSON e cada pokémon como lista de parâmetros (`congelarPokemon`). Nada aqui pode ler o
 * jogador vivo — se ler, reabre a fresta que separava as duas metades da Exp. Share por uma
 * transação inteira. Ver `congelarPokemon`.
 */
export async function flushJogadoresUmPorUm(lote) {
  if (!lote.length) return 0;
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    for (const p of lote) {
      // `diamonds` NÃO entra aqui, e `orbs` também não. As duas moedas pagas são escritas
      // pelos ledgers (`diamantes-db.mjs` e `orbs-db.mjs`), dentro de transação, e o que o sim
      // guarda em memória é só cache da tela. Se elas voltassem para esta linha, o flush
      // gravaria o cache por cima de um crédito de webhook que chegou nos últimos 5 segundos —
      // ou seja, apagaria uma compra já paga.
      await cli.query(
        `UPDATE players SET level=$2, xp=$3, gold=$4, hunt_slug=$5, active_poke=$6,
                            items=$7, balls=$8, automation=$9, pokedex=$10,
                            boss_points=$11, elo=$12, pvp_abates=$13, pvp_mortes=$14,
                            pvp_cooldown_ate=$15, vip_ate=$16, boosts=$17, boosts_hoje=$18,
                            bless=$19, compras_cooldown=$20, gender=$21, looktype=$22,
                            owned_outfits=$23, visual=$24, visual_ok=$25, tutorial_visto=$26,
                            frag_chave_total=$27, discord_pop_campanha=$28, xp_share=$29,
                            outland_tier=$30, xp_share_total=$31, vitrine=$32,
                            aviso_visto=$33, passe=$34,
                            last_seen=now()
         WHERE id=$1`,
        // `p.*` aqui é o PAYLOAD montado no `flush()` do sim — os jsonb já vêm como string
        // (ver `items`, `automation`, `pokedex`, e agora `xp_share`). `frag_chave_total` e
        // `xp_share` só passaram a chegar preenchidos quando o payload ganhou as duas chaves;
        // antes disso o `?? 0` / `?? '[]'` abaixo gravava o vazio a cada ciclo.
        [p.id, p.level, p.xp, p.gold, p.huntSlug, p.activeId, p.items, p.balls, p.automation, p.pokedex,
         p.bossPoints, p.elo, p.pvpAbates, p.pvpMortes, p.pvpCooldownAte,
         p.vipAte, p.boosts, p.boostsHoje, p.bless, p.comprasCooldown, p.gender, p.looktype, p.ownedOutfits,
         p.visual, p.visualOk, p.tutorialVisto, p.fragChaveTotal ?? 0, p.discordPopCampanha ?? 0,
         p.xpShare ?? '[]', p.outlandTier ?? 1, p.xpShareTotal ?? 0, p.vitrine ?? '[]',
         p.avisoVisto ?? 0, p.passe ?? '{}'],
      );
      // `p.pokemonsSujos` aqui são LISTAS DE PARÂMETROS, não pokémon — ver `congelarPokemon`.
      for (const valores of p.pokemonsSujos ?? []) await gravarPokemonEm(cli, valores);
    }
    await cli.query('COMMIT');
    return lote.length;
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}

// --------------------------------------------------------------- flush em lote

/**
 * Pedaços de cada consulta do lote. 250 jogadores dão alguns MB de JSON por consulta — longe de
 * qualquer teto do Postgres — e mantêm cada consulta curta o bastante para não segurar travas.
 */
const LOTE_JOGADORES = 250;
const LOTE_POKEMONS = 2000;

/**
 * Os mesmos 32 campos do UPDATE de `flushJogadoresUmPorUm`, lidos de um JSON com o tipo da
 * própria tabela (`json_populate_recordset(NULL::players, …)`): cada coluna recebe o tipo dela
 * sem uma lista de casts para manter em dia.
 */
const SQL_JOGADORES_LOTE = `
  UPDATE players AS p SET
    level = v.level, xp = v.xp, gold = v.gold, hunt_slug = v.hunt_slug, active_poke = v.active_poke,
    items = v.items, balls = v.balls, automation = v.automation, pokedex = v.pokedex,
    boss_points = v.boss_points, elo = v.elo, pvp_abates = v.pvp_abates, pvp_mortes = v.pvp_mortes,
    pvp_cooldown_ate = v.pvp_cooldown_ate, vip_ate = v.vip_ate, boosts = v.boosts, boosts_hoje = v.boosts_hoje,
    bless = v.bless, compras_cooldown = v.compras_cooldown, gender = v.gender, looktype = v.looktype,
    owned_outfits = v.owned_outfits, visual = v.visual, visual_ok = v.visual_ok, tutorial_visto = v.tutorial_visto,
    frag_chave_total = v.frag_chave_total, discord_pop_campanha = v.discord_pop_campanha, xp_share = v.xp_share,
    outland_tier = v.outland_tier, xp_share_total = v.xp_share_total, vitrine = v.vitrine,
    aviso_visto = v.aviso_visto, passe = v.passe,
    last_seen = now()
  FROM json_populate_recordset(NULL::players, $1::json) AS v
  WHERE p.id = v.id`;

/** O `SQL_POKEMON` em lote — `bonus_base` nulo mantém o que a linha já tem, como lá. */
const SQL_POKEMONS_LOTE = `
  UPDATE player_pokemon AS p SET
    level = v.level, xp = v.xp, hp = v.hp, slot = v.slot, power = v.power, species_id = v.species_id,
    tm_elemental = v.tm_elemental, tm_aoe = v.tm_aoe, held_item_id = v.held_item_id,
    bonus_base = COALESCE(v.bonus_base, p.bonus_base)
  FROM json_populate_recordset(NULL::player_pokemon, $1::json) AS v
  WHERE p.id = v.id`;

/** Escalar em JSON. `undefined` e `NaN` viram `null` — a coluna NOT NULL recusa, como recusaria o `pg`. */
const jsonEscalar = (v) => JSON.stringify(v ?? null) ?? 'null';
/** Um campo jsonb que já chegou como TEXTO JSON do `flush()`: entra cru, sem parse nem stringify. */
const jsonTexto = (texto) => (typeof texto === 'string' ? texto : 'null');

function jsonDoJogador(p) {
  return `{"id":${jsonEscalar(p.id)},"level":${jsonEscalar(p.level)},"xp":${jsonEscalar(p.xp)},`
    + `"gold":${jsonEscalar(p.gold)},"hunt_slug":${jsonEscalar(p.huntSlug)},"active_poke":${jsonEscalar(p.activeId)},`
    + `"items":${jsonTexto(p.items)},"balls":${jsonTexto(p.balls)},"automation":${jsonTexto(p.automation)},`
    + `"pokedex":${jsonTexto(p.pokedex)},"boss_points":${jsonEscalar(p.bossPoints)},"elo":${jsonEscalar(p.elo)},`
    + `"pvp_abates":${jsonEscalar(p.pvpAbates)},"pvp_mortes":${jsonEscalar(p.pvpMortes)},`
    + `"pvp_cooldown_ate":${jsonEscalar(p.pvpCooldownAte)},"vip_ate":${jsonEscalar(p.vipAte)},`
    + `"boosts":${jsonTexto(p.boosts)},"boosts_hoje":${jsonTexto(p.boostsHoje)},"bless":${jsonEscalar(p.bless)},`
    + `"compras_cooldown":${jsonTexto(p.comprasCooldown)},"gender":${jsonEscalar(p.gender)},`
    + `"looktype":${jsonEscalar(p.looktype)},"owned_outfits":${jsonTexto(p.ownedOutfits)},`
    + `"visual":${jsonTexto(p.visual)},"visual_ok":${jsonEscalar(p.visualOk)},"tutorial_visto":${jsonEscalar(p.tutorialVisto)},`
    + `"frag_chave_total":${jsonEscalar(p.fragChaveTotal ?? 0)},"discord_pop_campanha":${jsonEscalar(p.discordPopCampanha ?? 0)},`
    + `"xp_share":${jsonTexto(p.xpShare ?? '[]')},"outland_tier":${jsonEscalar(p.outlandTier ?? 1)},`
    + `"xp_share_total":${jsonEscalar(p.xpShareTotal ?? 0)},"vitrine":${jsonTexto(p.vitrine ?? '[]')},`
    + `"aviso_visto":${jsonEscalar(p.avisoVisto ?? 0)},"passe":${jsonTexto(p.passe ?? '{}')}}`;
}

/** `v` é a lista de `congelarPokemon`: id, nível, xp, hp, slot, poder, espécie, TM, TM em área, item, refino. */
function jsonDoPokemon(v) {
  return `{"id":${jsonEscalar(v[0])},"level":${jsonEscalar(v[1])},"xp":${jsonEscalar(v[2])},"hp":${jsonEscalar(v[3])},`
    + `"slot":${jsonEscalar(v[4])},"power":${jsonEscalar(v[5])},"species_id":${jsonEscalar(v[6])},`
    + `"tm_elemental":${jsonEscalar(v[7])},"tm_aoe":${jsonEscalar(v[8])},"held_item_id":${jsonEscalar(v[9])},`
    + `"bonus_base":${jsonTexto(v[10])}}`;
}

/**
 * Despeja um lote de jogadores sujos EM LOTE — o caminho padrão desde 14/09/2026.
 *
 * `flushJogadoresUmPorUm` fazia uma ida e volta ao banco por jogador e outra por pokémon sujo,
 * uma depois da outra, dentro da transação. Com ~700 jogadores num sim o flush final do SIGTERM
 * passou dos 30 s, e o mesmo custo se repetia a cada 5 s. Aqui o lote vira um texto JSON e UMA
 * consulta por pedaço. O contrato não muda: uma transação só, grava todo mundo ou ninguém — é
 * nele que o `flush()` do sim se apoia para devolver as marcas numa falha.
 *
 * `FLUSH_LOTE=0` no ambiente volta ao caminho de uma query por linha sem precisar de deploy.
 */
export async function flushJogadores(lote) {
  if (process.env.FLUSH_LOTE === '0') return flushJogadoresUmPorUm(lote);
  if (!lote.length) return 0;
  // O mesmo jogador pode vir duas vezes (sujo E na fila de saída): os dois retratos são do mesmo
  // instante, fica o último, e os pokémon das duas entradas se somam. Um UPDATE ... FROM com o
  // mesmo id repetido escolheria uma das linhas ao acaso — por isso a deduplicação é aqui.
  const porId = new Map();
  const pokemons = new Map();
  for (const p of lote) {
    porId.set(p.id, p);
    for (const valores of p.pokemonsSujos ?? []) pokemons.set(valores[0], valores);
  }
  const jogadores = [...porId.values()];
  const pks = [...pokemons.values()];

  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    for (let i = 0; i < jogadores.length; i += LOTE_JOGADORES) {
      const pedaco = jogadores.slice(i, i + LOTE_JOGADORES);
      await cli.query(SQL_JOGADORES_LOTE, [`[${pedaco.map(jsonDoJogador).join(',')}]`]);
    }
    for (let i = 0; i < pks.length; i += LOTE_POKEMONS) {
      const pedaco = pks.slice(i, i + LOTE_POKEMONS);
      await cli.query(SQL_POKEMONS_LOTE, [`[${pedaco.map(jsonDoPokemon).join(',')}]`]);
    }
    await cli.query('COMMIT');
    return lote.length;
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}

// ------------------------------------------------------------------ ranking
//
// Uma consulta por aba, no molde do `/api/game/rankings?tab=` do jogo original.
// Todas leem o Postgres direto: o ranking é do MUNDO, e a memória de um sim só conhece os
// jogadores do próprio shard. Em troca, o que se vê é o estado do último flush — até 5 s
// atrás. Para um placar isso é irrelevante, e mantém o tick longe do banco.

/**
 * A aparência de um treinador, do jeito que a lista desenha.
 *
 * Vai em TODA linha de placar de treinador: sem ela o ranking desenhava o mesmo boneco padrão
 * cinquenta vezes, e a customização que o jogador acabou de escolher não aparecia justamente
 * na tela em que ele é comparado com os outros.
 */
const aparencia = (r) => ({ looktype: r.looktype, vs: empacotarVisual(r.visual) });

/** Treinadores por nível (o desempate é o XP, como no índice). */
export async function rankingNivel(limite = 50) {
  const { rows } = await pool.query(
    `SELECT nick, level, xp, gender, looktype, visual FROM players
      ORDER BY level DESC, xp DESC LIMIT $1`,
    [limite],
  );
  return rows.map((r) => ({ nick: r.nick, level: r.level, valor: Number(r.xp), ...aparencia(r) }));
}

/**
 * Posição na tabela do PvP ranqueado. Zero para quem ainda não terminou o posicionamento.
 *
 * Lê `pvp_rank`, e não mais a coluna `players.elo` da arena aposentada — aquela parou de se
 * mover no dia em que a arena ao vivo saiu de cena.
 *
 * Esta posição é o que CONCEDE a vaga de Mestre e Challenger (ver `rankComVaga`), e por isso
 * ela tem dois filtros, não um:
 *
 *   · **`partidas`** — quem ainda posiciona não está na tabela e não disputa vaga.
 *   · **`ultima_em`** — quem passou `PVP_DECAIMENTO_HORAS` sem jogar SAI da contagem. Sem isso
 *     as cinquenta vagas seriam tomadas por quem chegou primeiro e parou de jogar, e a
 *     numeração de quem continua na ativa nunca andaria: o 21º seguiria 21º para sempre
 *     porque o 8º largou o jogo em março. Tirar o inativo da contagem é o que faz a fila
 *     ANDAR — e é a mesma leitura que `vagaDecaiu` faz do lado do rank.
 *
 * O inativo não recebe posição (cai no `?? 0`), o que é coerente: ele não tem vaga, e o rank
 * dele já é resolvido por `inativo` em `rankComVaga`, com os pontos intactos.
 */
export async function posicaoRankingElo(playerId, minimoPartidas = PVP_PARTIDAS_POSICIONAMENTO) {
  const { rows } = await pool.query(
    `SELECT pos::int AS pos FROM (
       SELECT player_id, ROW_NUMBER() OVER (ORDER BY pontos DESC, vitorias DESC, player_id ASC) AS pos
         FROM pvp_rank
        WHERE partidas >= $2
          AND ultima_em IS NOT NULL
          AND ultima_em >= now() - ($3::bigint * INTERVAL '1 millisecond')
     ) r
     WHERE player_id = $1`,
    [playerId, minimoPartidas, PVP_DECAIMENTO_MS],
  );
  return rows[0]?.pos ?? 0;
}

/**
 * Top Catch: quantas ESPÉCIES DIFERENTES o treinador já capturou.
 *
 * É a leitura do original — lá o topo marca 282 num catálogo de 443, e o perfil de um jogador
 * mediano marca 144. Fossem capturas totais, um veterano estaria na casa dos milhares.
 * A pokédex é `{ "<speciesId>": {k: kills, c: capturas} }`, então contar as espécies com
 * `c > 0` é exatamente isso.
 */
export async function rankingCapturas(limite = 50) {
  const { rows } = await pool.query(
    `SELECT nick, level, gender, looktype, visual,
            (SELECT count(*) FROM jsonb_each(pokedex) AS e(k, v) WHERE (v->>'c')::int > 0) AS valor
       FROM players
      ORDER BY valor DESC, level DESC
      LIMIT $1`,
    [limite],
  );
  return rows.map((r) => ({ nick: r.nick, level: r.level, valor: Number(r.valor), ...aparencia(r) }));
}

/** Top Coins: ouro acumulado do treinador. */
export async function rankingCoins(limite = 50) {
  const { rows } = await pool.query(
    `SELECT nick, level, gold AS valor, gender, looktype, visual FROM players
      ORDER BY gold DESC, level DESC LIMIT $1`,
    [limite],
  );
  return rows.map((r) => ({ nick: r.nick, level: r.level, valor: Number(r.valor), ...aparencia(r) }));
}

/**
 * Top PvP: a tabela do ranqueado.
 *
 * `valor` continua se chamando assim porque é o nome que TODA aba do placar usa — trocá-lo
 * aqui obrigaria a tela a saber que esta aba é diferente das outras seis. O que mudou é de
 * ONDE ele vem: pontos de rank em `pvp_rank`, e não mais o ELO da arena aposentada.
 *
 * `tierId` viaja junto para a lista desenhar o emblema ao lado do nick.
 */
export async function rankingElo(limite = 50, minimoPartidas = PVP_PARTIDAS_POSICIONAMENTO) {
  const { rows } = await pool.query(
    `SELECT p.nick, p.level, r.pontos AS valor, r.vitorias, r.derrotas, r.ultima_em,
            p.gender, p.looktype, p.visual
       FROM pvp_rank r JOIN players p ON p.id = r.player_id
      WHERE r.partidas >= $2
      ORDER BY r.pontos DESC, r.vitorias DESC, r.player_id ASC LIMIT $1`,
    [limite, minimoPartidas],
  );
  // O emblema de cada linha sai de `rankComVaga`, e não de `rankDePontos`, porque acima de
  // `PVP_PR_ELITE` os pontos sozinhos NÃO dizem o tier: Mestre e Challenger partem do mesmo PR
  // e quem separa os dois é a posição. Com `rankDePontos` a tabela pintava de Challenger todo
  // mundo que passasse de 1.500 — inclusive o 40º —, contradizendo o emblema que a ficha do
  // próprio jogador mostrava.
  //
  // A posição usada é a da ELITE ATIVA: quem decaiu não ocupa vaga (é o mesmo corte de
  // `posicaoRankingElo`). Desde 18/09/2026 os pontos dele também descem (`aplicarDecaimento`, a
  // cada poucos segundos), então isto só cobre o intervalo entre o prazo e a passada.
  let vaga = 0;
  return rows.map((r) => {
    const inativo = vagaDecaiu(r.ultima_em);
    if (!inativo) vaga++;
    const rank = rankComVaga(Number(r.valor), inativo ? 0 : vaga, { inativo });
    return {
      nick: r.nick,
      level: r.level,
      valor: Number(r.valor),
      abates: Number(r.vitorias),
      mortes: Number(r.derrotas),
      tierId: rank.tierId,
      inativo,
      ...aparencia(r),
    };
  });
}

/**
 * Bosses: quantas vezes cada treinador derrotou um lendário específico.
 *
 * O contador vitalício mora em `automation.bossKills` (`{ regice: 6, … }`). Só entra quem
 * tem pelo menos 1 vitória naquele boss — o resto nem aparece na lista.
 */
export async function rankingBossKills(bossKey, limite = 50) {
  const { rows } = await pool.query(
    `SELECT nick, level, gender, looktype, visual,
            COALESCE((automation->'bossKills'->>$1)::int, 0) AS valor
       FROM players
      WHERE COALESCE((automation->'bossKills'->>$1)::int, 0) > 0
      ORDER BY valor DESC, level DESC, id ASC
      LIMIT $2`,
    [bossKey, limite],
  );
  return rows.map((r) => ({ nick: r.nick, level: r.level, valor: Number(r.valor), ...aparencia(r) }));
}

/**
 * Pokémon Forte: os pokémon de maior PODER do mundo, de qualquer treinador.
 *
 * Ordena pela coluna `power`, que é gravada junto com o nível — daí o join sair barato e não
 * precisar abrir espécie nenhuma aqui.
 */
export async function rankingPoder(limite = 50) {
  const { rows } = await pool.query(
    `SELECT pp.species_id, pp.level, pp.power, pp.shiny, pp.potencia, p.nick
       FROM player_pokemon pp JOIN players p ON p.id = pp.player_id
      WHERE pp.power > 0
      ORDER BY pp.power DESC, pp.level DESC LIMIT $1`,
    [limite],
  );
  return rows.map((r) => ({
    nick: r.nick,
    speciesId: r.species_id,
    level: r.level,
    valor: r.power,
    shiny: r.shiny,
    potencia: r.potencia,
  }));
}

/** Ficha pública de um pokémon pelo nick do dono e id da linha. */
export async function pokemonFichaPorNickEId(nick, pokemonId) {
  const { rows } = await pool.query(
    `SELECT pp.*
       FROM player_pokemon pp
       JOIN players p ON p.id = pp.player_id
      WHERE lower(p.nick) = lower($1)
        AND pp.id = $2
        AND pp.anuncio_id IS NULL
      LIMIT 1`,
    [nick, pokemonId],
  );
  return rows[0] ?? null;
}

/** Pokémon concreto do placar de poder — chave nick + espécie + nível + power. */
export async function pokemonFichaRanking(nick, speciesId, level, power) {
  const { rows } = await pool.query(
    `SELECT pp.*
       FROM player_pokemon pp
       JOIN players p ON p.id = pp.player_id
      WHERE lower(p.nick) = lower($1)
        AND pp.species_id = $2
        AND pp.level = $3
        AND pp.power = $4
      LIMIT 1`,
    [nick, speciesId, level, power],
  );
  return rows[0] ?? null;
}

/**
 * A VITRINE de um treinador, em linhas de `player_pokemon` prontas para `montarPokemon`.
 *
 * Sem escolha gravada cai na EQUIPE — assim toda ficha pública tem vitrine, inclusive a de
 * quem nunca abriu a tela de montar. A ordem escolhida é preservada com `WITH ORDINALITY`:
 * um `= ANY($2)` devolveria os seis na ordem do índice, e a ordem da vitrine é do dono.
 */
async function vitrinePublica(playerId, ids, max) {
  if (ids.length) {
    const { rows } = await pool.query(
      `SELECT pp.* FROM player_pokemon pp
         JOIN unnest($2::bigint[]) WITH ORDINALITY AS o(id, pos) ON o.id = pp.id
        WHERE pp.player_id = $1
        ORDER BY o.pos`,
      [playerId, ids],
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT * FROM player_pokemon
      WHERE player_id = $1 AND slot IS NOT NULL ORDER BY slot LIMIT $2`,
    [playerId, max],
  );
  return rows;
}

/**
 * Ficha pública de um treinador — os mesmos números da ficha própria, sem dados de conta.
 *
 * `maxVitrine` vem do sim (`MAX_VITRINE`) em vez de estar escrito aqui: o tamanho da vitrine é
 * regra de jogo, e o banco não é lugar de guardar uma segunda cópia dela.
 */
export async function perfilDoTreinador(nick, maxVitrine = 6) {
  const { rows } = await pool.query(
    `SELECT id, nick, level, xp, gold, orbs, vip_ate, pokedex,
            boss_points, looktype, visual,
            perfil_stats_publico, vitrine,
            (SELECT count(*) FROM jsonb_each(pokedex) AS e(k, v) WHERE (v->>'c')::int > 0) AS especies_capt,
            (SELECT count(*) FROM player_pokemon WHERE player_id = players.id) AS time,
            (SELECT count(*) FROM player_pokemon WHERE player_id = players.id AND shiny = true) AS shinys_tem,
            (SELECT count(*) FROM player_pokemon WHERE player_id = players.id AND potencia = 5) AS p5_tem
       FROM players WHERE lower(nick) = lower($1)`,
    [nick],
  );
  const p = rows[0];
  if (!p) return null;
  const dex = p.pokedex ?? {};
  const entradas = Object.values(dex);
  const shinysVistos = entradas.reduce((s, d) => s + (Number(d.sv) || 0), 0);
  const statsPublico = p.perfil_stats_publico !== false;
  const idsVitrine = (Array.isArray(p.vitrine) ? p.vitrine : [])
    .map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, maxVitrine);
  return {
    // As linhas cruas da vitrine — quem as vira ficha é o sim, com o mesmo `montarPokemon`
    // que a ficha do ranking usa. O banco não conhece o catálogo de espécies.
    vitrineLinhas: await vitrinePublica(p.id, idsVitrine, maxVitrine),
    // O id do jogador vai junto só para o sim poder buscar a equipe de PvP dele (que mora em
    // `pvp_time`, de outro módulo). Ele é APAGADO antes de a ficha ir para a tela — ver
    // `ranking.perfil` no sim: id de banco não é informação de jogador.
    id: Number(p.id),
    nick: p.nick,
    level: p.level,
    xp: Number(p.xp),
    looktype: p.looktype,
    vs: empacotarVisual(p.visual),
    capturasEsp: Number(p.especies_capt),
    capturas: entradas.reduce((s, d) => s + (Number(d.c) || 0), 0),
    derrotas: entradas.reduce((s, d) => s + (Number(d.k) || 0), 0),
    vistas: Object.keys(dex).length,
    bossPontos: p.boss_points,
    // O rank do PvP NÃO sai daqui: `players.elo` é da arena aposentada e parou de se mover. O
    // sim o anexa de `pvp_rank` (ver `ranking.perfil`).
    gold: Number(p.gold),
    orbs: Number(p.orbs),
    vipAte: Number(p.vip_ate),
    time: Number(p.time),
    statsPublico,
    shinysVistos: statsPublico ? shinysVistos : null,
    shinysTem: statsPublico ? Number(p.shinys_tem) : null,
    p5Tem: statsPublico ? Number(p.p5_tem) : null,
  };
}

/** Pokémon ainda sem `power` gravado — usado no backfill de boot. */
export async function pokemonsSemPoder(limite = 500) {
  const { rows } = await pool.query(
    `SELECT id, species_id, level, quality, ivs, shiny, potencia FROM player_pokemon WHERE power = 0 LIMIT $1`,
    [limite],
  );
  return rows;
}

/** Varredura paginada — recálculo em massa do ranking ⚔ quando a fórmula muda. */
export async function pokemonsParaRecalcularPoder(limite = 500, lastId = 0) {
  const { rows } = await pool.query(
    `SELECT id, species_id, level, quality, ivs, shiny, potencia FROM player_pokemon
      WHERE id > $1 ORDER BY id LIMIT $2`,
    [lastId, limite],
  );
  return rows;
}

export async function lerMeta(chave) {
  const { rows } = await pool.query(`SELECT valor FROM game_meta WHERE chave = $1`, [chave]);
  return rows[0]?.valor ?? null;
}

export async function gravarMeta(chave, valor) {
  await pool.query(
    `INSERT INTO game_meta (chave, valor) VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
    [chave, String(valor)],
  );
}

export async function atualizarPerfilStatsPublico(playerId, publico) {
  await pool.query(`UPDATE players SET perfil_stats_publico = $2 WHERE id = $1`, [playerId, !!publico]);
}

/** Pokémon que nunca passaram pela roleta de potência (`potencia = 0`). */
export async function pokemonsSemPotencia(limite = 500) {
  const { rows } = await pool.query(
    `SELECT id FROM player_pokemon WHERE potencia = 0 LIMIT $1`,
    [limite],
  );
  return rows;
}

/**
 * Grava a potência de um lote e devolve as linhas para o recálculo do `power`.
 *
 * Potência mexe nos stats, então o poder gravado no ranking fica velho no mesmo instante —
 * por isso o RETURNING traz o que o chamador precisa para refazer a conta sem uma segunda
 * consulta.
 */
export async function gravarPotencias(lote) {
  if (!lote.length) return [];
  const { rows } = await pool.query(
    `UPDATE player_pokemon AS pp SET potencia = v.potencia
       FROM (SELECT unnest($1::bigint[]) AS id, unnest($2::smallint[]) AS potencia) AS v
      WHERE pp.id = v.id
      RETURNING pp.id, pp.species_id, pp.level, pp.quality, pp.ivs, pp.shiny, pp.potencia`,
    [lote.map((k) => k.id), lote.map((k) => k.potencia)],
  );
  return rows;
}

export async function gravarPoderes(lote) {
  if (!lote.length) return;
  await pool.query(
    `UPDATE player_pokemon AS pp SET power = v.power
       FROM (SELECT unnest($1::bigint[]) AS id, unnest($2::int[]) AS power) AS v
      WHERE pp.id = v.id`,
    [lote.map((k) => k.id), lote.map((k) => k.power)],
  );
}
