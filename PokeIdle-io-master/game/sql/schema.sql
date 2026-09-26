-- Schema do jogo. Carregado automaticamente pelo Postgres na primeira subida.
--
-- Regra de ouro: o Postgres é a fonte de verdade, mas NUNCA está no caminho crítico do tick.
-- A simulação lê o jogador uma vez ao conectar, mantém em memória, e o writer despeja o
-- estado sujo a cada FLUSH_MS (e no disconnect). Por isso quase tudo é jsonb: um jogador
-- inteiro sai e entra numa linha só, sem join no hot path.

CREATE TABLE IF NOT EXISTS players (
  id           BIGSERIAL PRIMARY KEY,
  nick         TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),

  level        INT  NOT NULL DEFAULT 1,
  xp           BIGINT NOT NULL DEFAULT 0,
  gold         BIGINT NOT NULL DEFAULT 500,
  diamonds     BIGINT NOT NULL DEFAULT 0,   -- moeda paga; a loja dela ainda não existe

  hunt_slug    TEXT,                        -- hunt em que está caçando agora
  active_poke  BIGINT,                      -- id em player_pokemon

  -- Pesca: uma segunda progressão, paralela ao nível. Sobe por PEIXE fisgado, não por XP,
  -- e é ela que decide quais pokémon de água mordem a isca (ver PESCA_TIERS em content.mjs).
  fishing_skill  INT  NOT NULL DEFAULT 0,
  fishing_fish   REAL NOT NULL DEFAULT 0,   -- peixes dentro do nível atual (fracionário: a faixa reduzida rende 0,5)
  fishing_tier   INT  NOT NULL DEFAULT 0,   -- faixa escolhida no Pescador

  -- Bosses: pontos ganhos derrubando boss de arena (o campo "points" da ficha deles, hoje 1).
  boss_points    INT  NOT NULL DEFAULT 0,

  -- PvP. O ELO é soma zero entre os dois lados de cada abate, então a média do mundo fica
  -- fixa em ELO_INICIAL. `pvp_cooldown_ate` é gravado (e não só mantido em memória) porque
  -- senão um F5 zeraria a espera de 5 minutos entre uma entrada e a seguinte.
  elo              INT    NOT NULL DEFAULT 1000,
  pvp_abates       INT    NOT NULL DEFAULT 0,
  pvp_mortes       INT    NOT NULL DEFAULT 0,
  pvp_cooldown_ate BIGINT NOT NULL DEFAULT 0,

  -- Loja VIP. Boosts e VIP são carimbos de expiração em ms; `boosts_hoje` guarda o limite
  -- diário por tipo ({ xp: { dia, n } }). Tudo pequeno e mudando junto: cabe em jsonb.
  vip_ate          BIGINT NOT NULL DEFAULT 0,
  boosts           JSONB  NOT NULL DEFAULT '{}'::jsonb,
  boosts_hoje      JSONB  NOT NULL DEFAULT '{}'::jsonb,
  bless            TEXT,                        -- blessplus | blessultra | blessmax | NULL
  compras_cooldown JSONB  NOT NULL DEFAULT '{}'::jsonb,
  passe            JSONB  NOT NULL DEFAULT '{}'::jsonb, -- Passe de Batalha: degrau, último resgate, prazo do VIP
  gender           TEXT   NOT NULL DEFAULT 'male',
  looktype         INT    NOT NULL DEFAULT 159, -- outfit equipada do treinador
  owned_outfits    JSONB  NOT NULL DEFAULT '[]'::jsonb,
  -- As cores do outfit, escolhidas no onboarding: { cabeca, corpo, pernas, pes }, cada uma um
  -- índice da paleta de 133 cores do Tibia (ver PERSONAGEM.md). São as quatro regiões que a
  -- máscara `_template` do atlas marca. Quatro números que mudam juntos: cabem no jsonb.
  --
  -- `visual_ok` é a TRAVA: a partir dele, mudar de aparência só comprando skin na loja — é o que
  -- dá valor à skin. E é o que `starter.pick` exige, porque o personagem vem antes do pokémon.
  visual           JSONB   NOT NULL DEFAULT '{}'::jsonb,
  visual_ok        BOOLEAN NOT NULL DEFAULT false,
  -- Última troca de avatar (o botão da ficha do treinador), em ms. A espera de 24 h é contada
  -- a partir daqui, e a coluna é gravada na hora do clique — fora do write-behind, senão
  -- fechar o jogo logo depois de trocar apagaria a trava.
  visual_trocado_em BIGINT NOT NULL DEFAULT 0,

  -- inventário e automações são pequenos e mudam junto: cabem em jsonb
  items        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { "<itemId>": qty }
  balls        JSONB NOT NULL DEFAULT '{"1":100}'::jsonb,
  automation   JSONB NOT NULL DEFAULT '{}'::jsonb,
  pokedex      JSONB NOT NULL DEFAULT '{}'::jsonb    -- { "<speciesId>": {k:kills, c:caught} }
);

CREATE TABLE IF NOT EXISTS player_pokemon (
  id          BIGSERIAL PRIMARY KEY,
  player_id   BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  species_id  INT    NOT NULL,
  level       INT    NOT NULL DEFAULT 1,
  xp          BIGINT NOT NULL DEFAULT 0,
  quality     REAL   NOT NULL DEFAULT 1,
  ivs         JSONB  NOT NULL,              -- { hp, atk, def, spAtk, spDef, speed } 1..32
  hp          INT    NOT NULL DEFAULT 1,    -- HP atual (0 = desmaiado)
  shiny       BOOLEAN NOT NULL DEFAULT false,
  slot        INT,                          -- 0..4 = equipe (5 lugares), NULL = depot
  -- Poder, desnormalizado: é função de (espécie, IVs, nível, qualidade) e portanto derivável,
  -- mas as bases da espécie vivem no JSON do espelho, não no banco. Sem a coluna, o ranking
  -- de "Pokémon Forte" teria de carregar TODOS os pokémon do mundo para calcular em JS.
  power       INT    NOT NULL DEFAULT 0,
  -- REFINO: { hp, atk, def, spAtk, spDef } — quantos "+1" o dono já comprou em cada stat-base,
  -- pagando em pedras de evolução do tipo do bicho. `{}` = nunca refinado (quase todos).
  -- A regra e a tabela de custo estão em src/shared/refino-stats.mjs.
  bonus_base  JSONB  NOT NULL DEFAULT '{}'::jsonb,
  caught_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ranking de Pokémon Forte: um índice só, já na ordem que a consulta pede.
CREATE INDEX IF NOT EXISTS idx_pp_power ON player_pokemon(power DESC);

CREATE INDEX IF NOT EXISTS idx_pp_player ON player_pokemon(player_id);
CREATE INDEX IF NOT EXISTS idx_pp_team   ON player_pokemon(player_id, slot) WHERE slot IS NOT NULL;

-- Ranking: materializado a partir de players, mas com índice próprio para não escanear tudo.
CREATE INDEX IF NOT EXISTS idx_players_level ON players(level DESC, xp DESC);
CREATE INDEX IF NOT EXISTS idx_players_seen  ON players(last_seen DESC);
