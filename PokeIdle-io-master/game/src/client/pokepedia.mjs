// A POKEPÉDIA — o manual do jogo, escrito por dentro.
//
// ### Por que isto é um módulo, e não mais um `render` no app.js
//
// Todo o resto da interface é RÓTULO: palavra curta, num lugar fixo, traduzida em
// `i18n.mjs`. A Pokepédia é CONTEÚDO — parágrafos inteiros, em três línguas, que crescem
// junto com o jogo. Enfiar isso no dicionário significaria centenas de chaves longas
// disputando espaço com "Cancelar" e "Nv", e o `teste-i18n` gastaria o dia comparando
// frases de dois parágrafos.
//
// Aqui cada capítulo carrega as três versões do próprio texto, lado a lado, e quem traduz vê
// as três juntas em vez de caçá-las em três blocos de 550 linhas.
//
// ### A regra que manda em tudo: NENHUM NÚMERO É ESCRITO À MÃO
//
// Um manual com número errado é pior que nenhum manual — o jogador confia, planeja em cima e
// descobre a mentira gastando ouro. Então toda tabela desta tela é MONTADA a partir do que o
// servidor mandou no `welcome`: as pokébolas, a tabela de tipos, a potência, as chances de
// shiny, os preços da loja, o spread da gema, as regras do PvP e as fichas dos
// bosses. Se o balanceamento mudar no servidor, esta tela muda junto, sozinha.
//
// Os poucos números que aparecem no texto corrido são os que NÃO trafegam (a curva de XP, os
// cooldowns do combate) e estão marcados um a um com o arquivo de onde saíram.

// As regras dos GINÁSIOS não trafegam no `welcome` — elas moram em `shared/`, que é o
// arquivo que cliente e servidor leem juntos. Importar daqui é a mesma promessa da regra
// acima por outro caminho: se o balanceamento mudar lá, este capítulo muda junto.
import {
  TIPOS_GINASIO,
  GINASIO_TIME_MAX,
  ARENA_NIVEL_CHEIO,
  GINASIO_NIVEL_MIN,
  GINASIO_BUFF_PCT,
  GINASIO_DESAFIO_COOLDOWN_MS,
  ARENA_EXPO_GUERRA,
  nivelNaGuerra,
} from '../shared/ginasios.mjs';
// Mesma promessa para o PvP RANQUEADO: a escada inteira (tiers, vagas, posicionamento,
// atrito da derrota, decaimento) mora em `shared/` e é lida por cliente e servidor. O
// capítulo 13 monta a tabela de ranks a partir daqui, sem número escrito à mão.
import {
  PVP_TIERS,
  PVP_PR_ELITE,
  PVP_VAGAS_MESTRE,
  PVP_VAGAS_CHALLENGER,
  PVP_PONTOS_POR_DIVISAO,
  PVP_PARTIDAS_POSICIONAMENTO,
  PVP_TETO_POSICIONAMENTO,
  PVP_ATRITO_DERROTA,
  PVP_ENTRE_PARTIDAS_MS,
  PVP_DECAIMENTO_HORAS,
  PVP_NIVEL_MIN,
  PVP_PREMIOS,
  PVP_TIME_MAX,
  PVP_TIME_MIN,
} from '../shared/pvp-rank.mjs';
// E a NOTA da calculadora: os degraus de cor saem de `FAIXAS_NOTA`, a mesma tabela que pinta a
// caixa grande da calculadora (`faixaDaNota`). Um degrau novo aparece na tabela do capítulo sozinho.
import { FAIXAS_NOTA, AUTO_LOCK_NOTA_MIN } from '../shared/nota-pokemon.mjs';
// A OFERENDA, o CAMPEONATO e o nível do EEVEE também moram em `shared/`, lidos pelas duas pontas:
// as casas da roleta, as datas, o requisito e o prêmio do campeonato, e o degrau fixo dos oito
// destinos do Eevee saem daqui, e não de um número copiado no texto.
import { OFERENDA_CASAS } from '../shared/oferenda.mjs';
// A ÁREA DE TREINAMENTO e as CAIXAS DO MARKET, pela mesma razão: os limites da bancada (casas
// por lado, espera entre batalhas) e as tabelas das caixas (preço, diamante, multiplicador e as
// chances de cada prêmio) moram em `shared/`. O capítulo monta a tabela a partir delas, então
// mexer no balanceamento muda a Wiki no mesmo commit.
import { TREINO_MAX_LADO, TREINO_COOLDOWN_MS } from '../shared/treino.mjs';
import {
  BOSS_TOKEN_ID, CAIXAS, FRAG_CHAVE_ID, TIER_COMUM, TIER_LENDARIO, TIER_RARO, conteudoDaCaixa,
} from '../shared/caixas-npc.mjs';
import { campeonatoDe, FUSO_CAMPEONATO } from '../shared/campeonato.mjs';
import { EVOLUCOES_RAMIFICADAS } from '../shared/evolucoes-ramificadas.mjs';
// As recompensas da GUILD (o bônus do ranking Diário e os diamantes da Temporada Global) são as
// mesmas que o servidor paga e que a folha 🏆 do PvP mostra.
import { BONUS_RANKING_GP, PREMIOS_GLOBAL } from '../shared/guild-premios.mjs';
import {
  TRILHA as TRILHA_PASSE, PASSE_DIAS, PASSE_VIP_PRECO, PASSE_VIP_DIAS, PASSE_NIVEL_MIN,
} from '../shared/passe-batalha.mjs';
// O golpe do TM ELEMENTAL é o mesmo que o servidor usa para lutar: power, cooldown e o raio da
// área saem daqui, e o capítulo de TM Disks conta o alcance dele a partir do raio.
import { TM_ELEMENTAL_POWER, TM_ELEMENTAL_CD_MS, TM_ELEMENTAL_RAIO } from '../shared/tm-elemental.mjs';
import { MEGAS, megaTemShiny } from '../shared/megas.mjs';

// Os números abaixo NÃO trafegam e não moram em `shared/` — cada um diz de onde saiu.
/** Teto de tempo simulado da Guerra de Guilds, em minutos: `LIMITE_MS_GUERRA`, em `server/game/guild-pvp-sim.mjs`. */
const MIN_GUERRA = 10;
/** Espera entre duas mensagens no chat público, em segundos: `CHAT_COOLDOWN_MS`, em `server/limites-ws.mjs`. */
const SEG_CHAT = 5;
/** A janela do sorteio na liberação do Mercado, em segundos: `JANELA_SORTEIO_MS`, em `server/sorteio-mercado.mjs`. */
const SEG_SORTEIO = 3;
/** O nível em que o Eevee evolui para qualquer um dos oito destinos. */
const NIVEL_EEVEE = EVOLUCOES_RAMIFICADAS[133]?.[0]?.nivel ?? 80;
/** Base da penalidade de equipe dos bosses: `BOSS_PENALIDADE_BASE`, em `server/game/bosses.mjs`. */
const BASE_PENALIDADE_BOSS = 3;
/** O lado do quadrado do TM AoE, em tiles: `TM_AOE_RAIO` (5), em `server/game/tm.mjs` — 2 × 5 + 1. */
const LADO_TM_AOE = 11;
/** O lado do quadrado do golpe do TM Elemental — com o centro no ALVO, não no pokémon do jogador. */
const LADO_TM_ELEMENTAL = 2 * TM_ELEMENTAL_RAIO + 1;
/**
 * Quantos dos 8 selvagens que cercam o pokémon o golpe do TM Elemental alcança, com o alvo em
 * (ax, ay) relativo ao pokémon. É a conta de `alvosDoGolpe` (`server/game/tm.mjs`): Chebyshev até
 * o alvo ≤ `TM_ELEMENTAL_RAIO`. Com raio 1 dá 5 com o alvo reto e 3 na diagonal, contando o alvo.
 */
const cercoNoTmElemental = (ax, ay) => {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && Math.max(Math.abs(dx - ax), Math.abs(dy - ay)) <= TM_ELEMENTAL_RAIO) n++;
    }
  }
  return n;
};
const TM_CERCO_RETO = cercoNoTmElemental(1, 0);
const TM_CERCO_DIAGONAL = cercoNoTmElemental(1, 1);

const T = ['NORMAL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'ICE', 'FIGHTING', 'POISON', 'GROUND',
  'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY'];

/** A espera entre dois desafios ao mesmo ginásio, em horas. */
const HORAS_DESAFIO_GINASIO = Math.round(GINASIO_DESAFIO_COOLDOWN_MS / 3_600_000);

/** Abreviação de três letras para caber na grade 18×18 sem virar coluna de 60 px. */
const CURTO = {
  NORMAL: 'NOR', FIRE: 'FOG', WATER: 'AGU', GRASS: 'PLA', ELECTRIC: 'ELE', ICE: 'GEL',
  FIGHTING: 'LUT', POISON: 'VEN', GROUND: 'TER', FLYING: 'VOO', PSYCHIC: 'PSI', BUG: 'INS',
  ROCK: 'ROC', GHOST: 'FAN', DRAGON: 'DRA', DARK: 'SOM', STEEL: 'MET', FAIRY: 'FAD',
};
const CURTO_EN = {
  NORMAL: 'NOR', FIRE: 'FIR', WATER: 'WAT', GRASS: 'GRA', ELECTRIC: 'ELE', ICE: 'ICE',
  FIGHTING: 'FIG', POISON: 'POI', GROUND: 'GRO', FLYING: 'FLY', PSYCHIC: 'PSY', BUG: 'BUG',
  ROCK: 'ROC', GHOST: 'GHO', DRAGON: 'DRA', DARK: 'DAR', STEEL: 'STE', FAIRY: 'FAI',
};

// ---------------------------------------------------------------- rótulos
//
// O vocabulário curto das tabelas, por língua. Só o que se repete em várias delas — o texto
// corrido de cada capítulo mora no próprio capítulo.

const ROTULOS = {
  pt: {
    bola: 'Pokébola', eficiencia: 'Eficiência', chanceCorpo: 'Chance (corpo caído)', preco: 'Preço', ouro: 'ouro',
    chance: 'Chance', bonus: 'Bônus', duracao: 'Duração', efeito: 'Efeito', diamantes: '💎',
    item: 'Item', valor: 'Valor', quanto: 'Quanto', quando: 'Quando', regra: 'Regra',
    nivel: 'Nível', xpTotal: 'XP total', custoNivel: 'Só deste nível',
    regiao: 'Região', nivelTreinador: 'Nv treinador',
    atacante: 'Golpe ↓', base: 'Normal', naHunt: 'Na hunt',
    tier: 'Tier', porEncontro: 'Por encontro', comIsca: 'Com Secret Lure', especies: 'Espécies',
    qualidade: 'Qualidade', rotulo: 'Rótulo',
    naoComprava: 'só com diamante', semLimite: 'sem limite', sim: 'sim', nao: 'não',
    taxa: 'Taxa', ondeIncide: 'Onde incide', quemPaga: 'Quem paga',
    porNivel: 'Por nível', totalAcum: 'Total', tipo: 'Tipo',
    pedra: 'Pedra', assinatura: 'Item assinatura', vira: 'Vira', ondeAparece: 'Hunt do alvo',
    mediaKills: 'Média de kills',
  },
  en: {
    bola: 'Poké Ball', eficiencia: 'Efficiency', chanceCorpo: 'Catch % (fainted)', preco: 'Price', ouro: 'gold',
    chance: 'Chance', bonus: 'Bonus', duracao: 'Duration', efeito: 'Effect', diamantes: '💎',
    item: 'Item', valor: 'Value', quanto: 'How much', quando: 'When', regra: 'Rule',
    nivel: 'Level', xpTotal: 'Total XP', custoNivel: 'This level only',
    regiao: 'Region', nivelTreinador: 'Trainer Lv',
    atacante: 'Move ↓', base: 'Normal', naHunt: 'On the hunt',
    tier: 'Tier', porEncontro: 'Per encounter', comIsca: 'With Secret Lure', especies: 'Species',
    qualidade: 'Quality', rotulo: 'Label',
    naoComprava: 'diamonds only', semLimite: 'no cap', sim: 'yes', nao: 'no',
    taxa: 'Fee', ondeIncide: 'Where it applies', quemPaga: 'Who pays',
    porNivel: 'Per level', totalAcum: 'Total', tipo: 'Type',
    pedra: 'Stone', assinatura: 'Signature item', vira: 'Becomes', ondeAparece: "Target's hunt",
    mediaKills: 'Avg. kills',
  },
  es: {
    bola: 'Poké Ball', eficiencia: 'Eficiencia', chanceCorpo: 'Chance (derrotado)', preco: 'Precio', ouro: 'oro',
    chance: 'Probabilidad', bonus: 'Bono', duracao: 'Duración', efeito: 'Efecto', diamantes: '💎',
    item: 'Objeto', valor: 'Valor', quanto: 'Cuánto', quando: 'Cuándo', regra: 'Regla',
    nivel: 'Nivel', xpTotal: 'XP total', custoNivel: 'Solo de este nivel',
    regiao: 'Región', nivelTreinador: 'Nv entrenador',
    atacante: 'Golpe ↓', base: 'Normal', naHunt: 'En la cacería',
    tier: 'Tier', porEncontro: 'Por encuentro', comIsca: 'Con Secret Lure', especies: 'Especies',
    qualidade: 'Calidad', rotulo: 'Etiqueta',
    naoComprava: 'solo con diamantes', semLimite: 'sin tope', sim: 'sí', nao: 'no',
    taxa: 'Comisión', ondeIncide: 'Dónde se aplica', quemPaga: 'Quién paga',
    porNivel: 'Por nivel', totalAcum: 'Total', tipo: 'Tipo',
    pedra: 'Piedra', assinatura: 'Ítem insignia', vira: 'Se convierte en', ondeAparece: 'Cacería del objetivo',
    mediaKills: 'Media de kills',
  },
};

// ------------------------------------------------------------- utilidades

const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

const N = (n, lang) => (n ?? 0).toLocaleString(lang === 'pt' ? 'pt-BR' : lang === 'es' ? 'es-ES' : 'en-US');

/**
 * Porcentagem com as casas que o valor merece.
 *
 * A escada é a mesma do `pct` do app.js, e existe pelo mesmo motivo: a potência 5 é 0,005%, e
 * arredondar para duas casas dobraria o número mais raro da tabela.
 */
const P = (v, lang) => {
  const casas = v >= 0.1 ? 1 : v >= 0.001 ? 2 : v >= 0.00001 ? 4 : 6;
  const s = (v * 100).toFixed(casas);
  return `${lang === 'en' ? s : s.replace('.', ',')}%`;
};

const umEm = (c) => (c > 0 ? `1 / ${Math.round(1 / c).toLocaleString('en-US').replace(/,/g, '.')}` : '—');

/** Chance do Bronze Boss Token por kill na Outland — vem do `welcome`, não hardcoded. */
const chanceBossToken = (c) => c.d.chanceBossToken ?? 0.0005;
const pctBossToken = (c) => P(chanceBossToken(c), c.lang);
const mediaBossToken = (c) => N(Math.round(1 / chanceBossToken(c)), c.lang);

/**
 * A ESCADA DAS OUTLANDS — o degrau que o jogador escolhe no seletor da aba Outland do mapa.
 *
 * Mesmo mapa, mesmos selvagens, mesmo nível 150 em todos os degraus. O que muda é a chance
 * dos TRÊS drops raros da área. Os números vêm do `welcome` (`shared/outland-tiers.mjs` no
 * servidor); a reserva abaixo é só para o manual abrir antes de o welcome chegar.
 *
 * Nada neste capítulo conta degraus à mão: título, texto e tabela saem todos desta lista, para
 * que uma Outland nova (ou um multiplicador rebalanceado) não deixe o manual mentindo.
 */
const tiersOutland = (c) => c.d.outlandTiers ?? [
  { tier: 1, rotulo: 'Outland 1', nivel: 150, mult: 1 },
  { tier: 2, rotulo: 'Outland 2', nivel: 500, mult: 1.25 },
  { tier: 3, rotulo: 'Outland 3', nivel: 1000, mult: 1.5 },
  { tier: 4, rotulo: 'Outland 4', nivel: 2000, mult: 2 },
  { tier: 5, rotulo: 'Outland 5', nivel: 4000, mult: 3 },
  { tier: 6, rotulo: 'Outland 6', nivel: 8000, mult: 4 },
  { tier: 7, rotulo: 'Outland 7', nivel: 16000, mult: 6 },
  { tier: 8, rotulo: 'Outland 8', nivel: 25000, mult: 8 },
];

/** Quantas Outlands existem — o número que os títulos e as frases usam. */
const quantasOutlands = (c) => N(tiersOutland(c).length, c.lang);

/** O maior multiplicador da escada, já com vírgula ou ponto conforme a língua. */
const maiorMultOutland = (c) => N(Math.max(...tiersOutland(c).map((x) => x.mult)), c.lang);

/**
 * A frase curta que os capítulos da Casa e da Shiny Stone usam para não repetir a tabela.
 *
 * Eles falam da chance BASE (a da Outland 1); esta linha é o "e nas de cima". Diz só o TETO da
 * escada em vez de enumerar degrau por degrau — enumerada, ela viraria uma frase de várias
 * linhas no meio de um parágrafo que fala de outra coisa, e cresceria a cada Outland nova.
 * Quem quer a escada inteira segue o link para o capítulo de Combate, onde ela está em tabela.
 * O Bronze Boss Token aponta para `bosses`, que tem a chance dele já multiplicada Outland a Outland.
 */
const dicaOutlandTiers = (c, cap = 'combate') => {
  if (!tiersOutland(c).some((x) => x.mult > 1)) return '';
  const teto = maiorMultOutland(c);
  const link = cap === 'bosses'
    ? `<a data-cap="bosses">Bosses</a>`
    : `<a data-cap="combate">${c.lang === 'en' ? 'Combat' : 'Combate'}</a>`;
  if (c.lang === 'en') {
    return ` That is the Outland 1 rate — the other steps multiply it up to <b>×${teto}</b>`
      + ` (see ${link}).`;
  }
  if (c.lang === 'es') {
    return ` Esa es la probabilidad en Outland 1 — los demás escalones la multiplican hasta`
      + ` <b>×${teto}</b> (ver ${link}).`;
  }
  return ` Essa é a chance na Outland 1 — os degraus de cima multiplicam até <b>×${teto}</b>`
    + ` (ver ${link}).`;
};

/** A escada inteira: nível de entrada e multiplicador dos raros, um degrau por linha. */
const tabelaOutlandTiers = (c) => tabela(
  [c.r.regiao, c.r.nivelTreinador, c.r.bonus],
  tiersOutland(c)
    .map((x) => `<tr><td>${esc(x.rotulo)}</td><td class="wk-num">${N(x.nivel, c.lang)}</td>` +
      `<td class="wk-num${x.mult > 1 ? ' destaque' : ''}">×${N(x.mult, c.lang)}</td></tr>`)
    .join(''),
);

/**
 * A chance do Bronze Boss Token em cada Outland, já multiplicada — o capítulo de Bosses mostra
 * a conta pronta, porque é a pergunta de quem abre ali ("quantas kills por token na minha?").
 * Sem Loot Boost: ele multiplica por cima de qualquer linha.
 */
const tabelaBossTokenPorOutland = (c) => tabela(
  [c.r.regiao, c.r.nivelTreinador, c.r.chance, c.r.mediaKills],
  tiersOutland(c)
    .map((x) => {
      const ch = chanceBossToken(c) * x.mult;
      return `<tr><td>${esc(x.rotulo)}</td><td class="wk-num">${N(x.nivel, c.lang)}</td>` +
        `<td class="wk-num${x.mult > 1 ? ' destaque' : ''}">${P(ch, c.lang)}</td>` +
        `<td class="wk-num">~${N(Math.round(1 / ch), c.lang)}</td></tr>`;
    })
    .join(''),
);

// ------------------------------------------------------------------ PvP ranqueado
//
// Os nomes dos tiers por língua. O `id` é o do servidor (`PVP_TIERS`), e é ele que manda: um
// tier novo aparece na tabela assim que entrar lá, e só o RÓTULO precisa vir aqui.
const NOME_TIER = {
  pt: {
    bronze: 'Bronze', prata: 'Prata', ouro: 'Ouro', platina: 'Platina',
    diamante: 'Diamante', mestre: 'Mestre', challenger: 'Challenger',
  },
  en: {
    bronze: 'Bronze', prata: 'Silver', ouro: 'Gold', platina: 'Platinum',
    diamante: 'Diamond', mestre: 'Master', challenger: 'Challenger',
  },
  es: {
    bronze: 'Bronce', prata: 'Plata', ouro: 'Oro', platina: 'Platino',
    diamante: 'Diamante', mestre: 'Maestro', challenger: 'Challenger',
  },
};

const ROTULO_RANK = {
  pt: { rank: 'Rank', comoEntra: 'Como se entra', divisoes: 'Divisões' },
  en: { rank: 'Rank', comoEntra: 'How you get in', divisoes: 'Divisions' },
  es: { rank: 'Rango', comoEntra: 'Cómo se entra', divisoes: 'Divisiones' },
};

/**
 * A escada dos sete ranks, montada a partir de `PVP_TIERS`.
 *
 * Nada é escrito à mão — nem a faixa de PR de cada tier, nem quantas vagas têm os dois do topo.
 * Mexer no balanceamento em `shared/pvp-rank.mjs` muda esta tabela junto, que é a promessa do
 * cabeçalho deste arquivo.
 */
function tabelaDeRanks(c) {
  const nomes = NOME_TIER[c.lang] ?? NOME_TIER.pt;
  const r = ROTULO_RANK[c.lang] ?? ROTULO_RANK.pt;
  const elite = N(PVP_PR_ELITE, c.lang);

  const comoEntra = (t) => {
    if (t.id === 'challenger') {
      return c.lang === 'pt'
        ? `<b>${elite} PR</b> e estar entre os <b>${N(PVP_VAGAS_CHALLENGER, c.lang)} primeiros</b>`
        : c.lang === 'es'
          ? `<b>${elite} PR</b> y estar entre los <b>${N(PVP_VAGAS_CHALLENGER, c.lang)} primeros</b>`
          : `<b>${elite} PR</b> and being in the <b>top ${N(PVP_VAGAS_CHALLENGER, c.lang)}</b>`;
    }
    if (t.id === 'mestre') {
      const de = N(PVP_VAGAS_CHALLENGER + 1, c.lang);
      const ate = N(PVP_VAGAS_MESTRE, c.lang);
      return c.lang === 'pt'
        ? `<b>${elite} PR</b> e ficar entre <b>${de}º e ${ate}º</b>`
        : c.lang === 'es'
          ? `<b>${elite} PR</b> y quedar entre <b>${de}º y ${ate}º</b>`
          : `<b>${elite} PR</b> and placing <b>${de}th to ${ate}th</b>`;
    }
    const ate = t.de + t.divisoes * PVP_PONTOS_POR_DIVISAO - 1;
    return `${N(t.de, c.lang)} – ${N(ate, c.lang)} PR`;
  };

  const linhas = PVP_TIERS.map((t) => {
    const eliteTier = t.id === 'mestre' || t.id === 'challenger';
    return `<tr>
      <td><b${eliteTier ? ' class="wk-num destaque"' : ''}>${esc(nomes[t.id] ?? t.id)}</b></td>
      <td>${comoEntra(t)}</td>
      <td>${eliteTier ? '—' : 'I · II · III'}</td>
    </tr>`;
  }).join('');

  return tabela([r.rank, r.comoEntra, r.divisoes], linhas);
}

// ------------------------------------------------------------ Casa e XP Share
//
// Tudo daqui sai de `estado.casas`, que o servidor monta em `sim.mjs` a partir das MESMAS
// constantes que ele usa para sortear e para creditar XP. Os `??` são a rede de baixo para o
// caso de o manual abrir antes de o welcome chegar — nunca a fonte.

const cfgCasas = (c) => c.d.casas ?? {};
const raridadesDeCasa = (c) => cfgCasas(c).raridades ?? [];
const cfgFrag = (c) => cfgCasas(c).fragmento ?? {};
const custoFragCasa = (c) => cfgFrag(c).custo ?? 10;
const chanceFragChave = (c) => cfgFrag(c).chanceDrop ?? 0.000005;
const pctFragChave = (c) => P(chanceFragChave(c), c.lang);
const mediaFragChave = (c) => N(Math.round(1 / chanceFragChave(c)), c.lang);
/** Quantas casas valem ao mesmo tempo — ter mais não tem teto, usar tem. */
const maxCasasEmUso = (c) => cfgCasas(c).maxEmUso ?? 5;
/**
 * A fatia de XP Share de uma raridade, redonda.
 *
 * O `P` geral daqui abre uma casa decimal (é feito para chance de drop, onde 0,005% importa) e
 * escreveria "75,0%" numa coluna cujos cinco valores são 25, 40, 75, 100 e 100. Número redondo
 * é o que faz a escada ser lida de relance.
 */
const PCT_CASA = (v) => `${Math.round((v ?? 0) * 100)}%`;

/**
 * A porcentagem do item Exp. Share (held), inteira.
 *
 * Sai do `welcome` (`xpShareHeld.pct`, que o servidor calcula de `XP_SHARE_HELD_PCT`) pelo mesmo
 * motivo das casas: se alguém balancear o item, o manual acompanha sem ninguém lembrar de vir
 * aqui. O `?? 5` é só a rede para o manual aberto antes do welcome chegar.
 */
const pctXpShareHeld = (c) => Math.round(c.d.xpShareHeld?.pct ?? 5);

const cfgPedra = (c) => c.d.shinyStone ?? {};
const custoFragPedra = (c) => cfgPedra(c).custo ?? 10;
const chanceFragPedra = (c) => cfgPedra(c).chanceDrop ?? 0.000005;
const pctFragPedra = (c) => P(chanceFragPedra(c), c.lang);
const mediaFragPedra = (c) => N(Math.round(1 / chanceFragPedra(c)), c.lang);

const ROTULO_CASA = {
  pt: { casa: 'Casa', xp: 'XP Share', bonecos: 'Pokémon', chance: 'Chance no sorteio' },
  en: { casa: 'House', xp: 'XP Share', bonecos: 'Pokémon', chance: 'Roll chance' },
  es: { casa: 'Casa', xp: 'XP Share', bonecos: 'Pokémon', chance: 'Probabilidad' },
};

/**
 * O NOME de cada raridade por língua.
 *
 * O servidor manda `rotulo`, mas ele é em português (é o rótulo do editor de casas) — usá-lo
 * direto punha "Comum / Mítica / Lendária" na tabela de quem joga em inglês, no meio de um
 * capítulo traduzido. Os cinco ids são fechados e não crescem, então a tradução mora aqui, do
 * mesmo jeito que o resto do vocabulário desta tela.
 */
const NOME_RARIDADE = {
  comum: { pt: 'Comum', en: 'Common', es: 'Común' },
  incomum: { pt: 'Incomum', en: 'Uncommon', es: 'Poco común' },
  rara: { pt: 'Rara', en: 'Rare', es: 'Rara' },
  mitica: { pt: 'Mítica', en: 'Mythic', es: 'Mítica' },
  lendaria: { pt: 'Lendária', en: 'Legendary', es: 'Legendaria' },
};

/** As cinco raridades: a fatia do XP Share, quantos postos e a chance de sair no sorteio. */
function tabelaDeCasas(c) {
  const r = ROTULO_CASA[c.lang] ?? ROTULO_CASA.pt;
  const lista = raridadesDeCasa(c);
  const total = lista.reduce((s, x) => s + x.peso, 0) || 1;
  const linhas = lista.map((x) => `
    <tr>
      <td><b>${NOME_RARIDADE[x.id]?.[c.lang] ?? x.rotulo}</b></td>
      <td>${PCT_CASA(x.xpShare)}</td>
      <td>${N(x.bonecos, c.lang)}</td>
      <td>${P(x.peso / total, c.lang)}</td>
    </tr>`).join('');
  return tabela([r.casa, r.xp, r.bonecos, r.chance], linhas);
}

// ------------------------------------------------------------ Bicicletas
//
// Como a Casa: nenhum número escrito à mão. Velocidade, pesos do sorteio, custo e chance do
// fragmento vêm de `estado.bicicletas` (welcome); a espera da troca, do snapshot do jogador.

const cfgBikes = (c) => c.d.bicicletas ?? {};
const raridadesDeBike = (c) => cfgBikes(c).raridades ?? [];
const custoFragBike = (c) => cfgBikes(c).fragmento?.custo ?? 10;
const chanceFragBike = (c) => cfgBikes(c).fragmento?.chanceDrop ?? 0.000005;
const minTrocaBike = (c) => Math.round((c.d.eu?.bicicleta?.intervaloTrocaMs ?? 300_000) / 60_000);
/** A velocidade a mais da i-ésima raridade, em pontos percentuais (0 se o welcome não chegou). */
const pctBike = (c, i) => Math.round((raridadesDeBike(c)[i]?.velocidade ?? 0) * 100);

const ROTULO_BIKE = {
  pt: { bike: 'Bicicleta', velocidade: 'Velocidade', passo: 'Tempo de cada passo', chance: 'Chance no sorteio' },
  en: { bike: 'Bicycle', velocidade: 'Speed', passo: 'Time per step', chance: 'Roll chance' },
  es: { bike: 'Bicicleta', velocidade: 'Velocidad', passo: 'Tiempo de cada paso', chance: 'Probabilidad en el sorteo' },
};

/**
 * As cinco bicicletas: quanto a mais de velocidade, quanto dura o passo comparado a andar a pé e a
 * chance de sair. O passo DIVIDE pelo fator (`fatorPassoDaRaridade`), então +100% é passo pela
 * metade — e não "passo zero", que é o que a porcentagem sozinha faria alguém imaginar.
 */
function tabelaDeBicicletas(c) {
  const r = ROTULO_BIKE[c.lang] ?? ROTULO_BIKE.pt;
  const lista = raridadesDeBike(c);
  const total = lista.reduce((s, x) => s + x.peso, 0) || 1;
  const linhas = lista.map((x) => `
    <tr>
      <td><b>${NOME_RARIDADE[x.id]?.[c.lang] ?? esc(x.rotulo)}</b></td>
      <td class="wk-num">+${Math.round(x.velocidade * 100)}%</td>
      <td class="wk-num">${Math.round(100 / (1 + x.velocidade))}%</td>
      <td class="wk-num">${P(x.peso / total, c.lang)}</td>
    </tr>`).join('');
  return tabela([r.bike, r.velocidade, r.passo, r.chance], linhas);
}

/**
 * Uma tabela com cabeçalho e linhas já em HTML, dentro do seu próprio vão de rolagem.
 *
 * O `.wk-rolar` não é enfeite. A `.wk-tabela` tem `overflow: hidden` (é o que arredonda os
 * cantos), então uma tabela mais larga que a tela era CORTADA — a coluna da direita ficava
 * ilegível e inalcançável, sem rolagem que chegasse nela. Foi o que aconteceu no celular
 * quando a tabela das pokébolas ganhou a quarta coluna: o Preço sumia pela beirada.
 *
 * Com o vão, a tabela larga rola por dentro (o mesmo que a `.wk-formula` já fazia com as
 * fórmulas longas) e a página nunca anda de lado.
 */
const tabela = (cabecalho, linhas, classe = '') => `
  <div class="wk-rolar">
    <table class="wk-tabela ${classe}">
      <thead><tr>${cabecalho.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${linhas}</tbody>
    </table>
  </div>`;

/** Caixa de destaque — o "preste atenção nisto" de cada capítulo. */
const nota = (texto, tipo = '') => `<div class="wk-nota ${tipo}">${texto}</div>`;

/**
 * "0,25%" — a chance escrita SEM arredondar para cima.
 *
 * Duas casas e sem zero à direita, a mesma regra da ficha do boss. Uma casa só mostrava o
 * fragmento de mega shiny (0,25%) como "0,3%", e este manual é justamente onde o jogador vai
 * comparar 0,25% com 0,50% antes de decidir o que farmar.
 */
const pctMega = (v) => `${((v ?? 0) * 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',')}%`;

/** O nome de um prêmio das caixas, nas três línguas — os ids vêm de `shared/caixas-npc.mjs`. */
const NOMES_PREMIO_CAIXA = {
  5: { pt: 'Beast Ball', en: 'Beast Ball', es: 'Beast Ball' },
  70000: { pt: 'Bronze Boss Token', en: 'Bronze Boss Token', es: 'Bronze Boss Token' },
  70011: { pt: 'Fragmento de Chave', en: 'Key Fragment', es: 'Fragmento de Llave' },
  70012: { pt: 'Fragmento de Shiny Stone', en: 'Shiny Stone Fragment', es: 'Fragmento de Shiny Stone' },
  70013: { pt: 'Fragmento de Bicicleta', en: 'Bicycle Fragment', es: 'Fragmento de Bicicleta' },
  1: { pt: 'Poké Ball', en: 'Poké Ball', es: 'Poké Ball' },
  2: { pt: 'Great Ball', en: 'Great Ball', es: 'Great Ball' },
  3: { pt: 'Super Ball', en: 'Super Ball', es: 'Super Ball' },
  4: { pt: 'Ultra Ball', en: 'Ultra Ball', es: 'Ultra Ball' },
  203: { pt: 'Hyper Potion', en: 'Hyper Potion', es: 'Hyper Potion' },
  204: { pt: 'Ultimate Potion', en: 'Ultimate Potion', es: 'Ultimate Potion' },
  205: { pt: 'Revive', en: 'Revive', es: 'Revive' },
  206: { pt: 'Max Revive', en: 'Max Revive', es: 'Max Revive' },
  70070: { pt: 'Golden Potion', en: 'Golden Potion', es: 'Golden Potion' },
};
const nomePremioWiki = (premio, c) => {
  const nome = NOMES_PREMIO_CAIXA[premio.id]?.[c.lang] ?? NOMES_PREMIO_CAIXA[premio.id]?.pt ?? `#${premio.id}`;
  return premio.qtd > 1 ? `${nome} ×${N(premio.qtd, c.lang)}` : nome;
};
/** A chance de uma linha da caixa, com duas casas onde moram os lendários. */
const pctCaixa = (chance, lang) => `${(chance * 100).toLocaleString(
  lang === 'pt' ? 'pt-BR' : lang === 'es' ? 'es-ES' : 'en-US',
  chance * 100 >= 1 ? { minimumFractionDigits: 1, maximumFractionDigits: 1 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
)}%`;

/**
 * As dez faixas de cor da nota da calculadora, de 0–1 a 9–10.
 *
 * Os limites saem de `FAIXAS_NOTA`; quem cai bem no limite fica na faixa de baixo, como em
 * `faixaDaNota`. Os nomes repetem `calc.faixa.*` do i18n — o `t()` só fala a língua atual e a
 * Pokepédia monta as três — e a cor descreve o `.calc-nota.<faixa>` do estilo.css, que também
 * pinta o nome aqui (`.wk-faixa-nota`).
 */
const FAIXA_NOTA_DOC = {
  'extremamente-fraco': { pt: ['Extremamente Fraco', 'cinza'], en: ['Extremely Weak', 'gray'], es: ['Extremadamente Débil', 'gris'] },
  fraco: { pt: ['Fraco', 'vermelho'], en: ['Weak', 'red'], es: ['Débil', 'rojo'] },
  mediano: { pt: ['Mediano', 'laranja'], en: ['Average', 'orange'], es: ['Medio', 'naranja'] },
  razoavel: { pt: ['Razoável', 'verde'], en: ['Fair', 'green'], es: ['Razonable', 'verde'] },
  bom: { pt: ['Bom', 'verde-claro'], en: ['Good', 'light green'], es: ['Bueno', 'verde claro'] },
  forte: { pt: ['Forte', 'verde vibrante, brilho pulsando'], en: ['Strong', 'bright green, pulsing glow'], es: ['Fuerte', 'verde vibrante, brillo que late'] },
  poderoso: { pt: ['Poderoso', 'lilás, brilho leve'], en: ['Powerful', 'lilac, soft glow'], es: ['Poderoso', 'lila, brillo suave'] },
  mitico: { pt: ['Mítico', 'roxo reluzente, moldura pulsando'], en: ['Mythic', 'glowing purple, pulsing frame'], es: ['Mítico', 'morado brillante, marco que late'] },
  legendario: { pt: ['Lendário', 'rosa-claro, com brilho'], en: ['Legendary', 'light pink, glowing'], es: ['Legendario', 'rosa claro, con brillo'] },
  divino: { pt: ['Divino', 'rosa reluzente, moldura pulsando'], en: ['Divine', 'glowing pink, pulsing frame'], es: ['Divino', 'rosa brillante, marco que late'] },
};

function tabelaDeFaixasDaNota(lang) {
  const cabecalho = { pt: ['Nota', 'Faixa', 'Cor'], en: ['Score', 'Tier', 'Color'], es: ['Nota', 'Rango', 'Color'] }[lang];
  const linhas = FAIXAS_NOTA.map((f, i) => {
    const [nome, cor] = FAIXA_NOTA_DOC[f.id]?.[lang] ?? [f.id, ''];
    return `<tr>
        <td class="wk-num">${i ? FAIXAS_NOTA[i - 1].ate : 0}–${f.ate}</td>
        <td><b class="wk-faixa-nota ${f.id}">${nome}</b></td>
        <td class="wk-desc">${cor}</td>
      </tr>`;
  }).join('');
  return tabela(cabecalho, linhas);
}

/** A curva de XP do jogo (`xpTotalParaNivel`, em content.mjs). Não trafega — é fórmula. */
const xpAcumulado = (L) => (L <= 1 ? 0 : Math.round((50 / 3) * (L ** 3 - 6 * L ** 2 + 17 * L - 12)));

/** Degraus de nível do treinador no Mapa — espelha `REGIOES_MAPA` em app.js. */
const REGIOES_MAPA_DOC = [
  { rotulo: { pt: 'Kanto', en: 'Kanto', es: 'Kanto' }, nivel: 1 },
  { rotulo: { pt: 'Johto', en: 'Johto', es: 'Johto' }, nivel: 1 },
  { rotulo: { pt: 'Outland', en: 'Outland', es: 'Outland' }, nivel: 150 },
  { rotulo: { pt: 'Hoenn', en: 'Hoenn', es: 'Hoenn' }, nivel: 500 },
  { rotulo: { pt: 'Sinnoh', en: 'Sinnoh', es: 'Sinnoh' }, nivel: 1000 },
  { rotulo: { pt: 'Unova', en: 'Unova', es: 'Unova' }, nivel: 5000 },
  { rotulo: { pt: 'Kalos', en: 'Kalos', es: 'Kalos' }, nivel: 10000 },
  { rotulo: { pt: 'Alola', en: 'Alola', es: 'Alola' }, nivel: 25000 },
];

function tabelaDeRegioes(c) {
  const linhas = REGIOES_MAPA_DOC.map(
    (r) => `<tr>
      <td>${esc(r.rotulo[c.lang] ?? r.rotulo.pt)}</td>
      <td class="wk-num">${N(r.nivel, c.lang)}</td>
    </tr>`,
  ).join('');
  return tabela([c.r.regiao ?? 'Região', c.r.nivelTreinador ?? 'Nv treinador'], linhas);
}

// -------------------------------------------------------- blocos dinâmicos
//
// Cada um monta uma tabela a partir do que o servidor mandou. O `c` é o contexto: `c.d` são
// os dados do welcome, `c.r` são os rótulos da língua e `c.lang` é o código dela.

/** Espelho de `chanceDeCaptura` no app.js — corpo caído (hpFrac = 0). */
function chanceCapturaWiki(c, precoNpc, catchRate) {
  const cap = c.d.captura ?? { base: 0.0075, piso: 0.003, teto: 0.1, raridadeDiv: 17, precoSemPreco: 6.5e9 };
  if (catchRate >= 255) return 1;
  const preco = precoNpc > 0 ? precoNpc : cap.precoSemPreco;
  const raridade = Math.log10(Math.max(100, preco)) - 1;
  const fator = 1 + raridade ** 3 / (cap.raridadeDiv ?? 17);
  return Math.max(cap.piso, Math.min(cap.teto, cap.base * (catchRate / fator) * 1.4));
}

/** Referência da espécie mais comum (raridade 1) — `max(100, priceNpc)` no servidor. */
const PRECO_CAPTURA_FACIL = 100;
/** Raridade mediana citada no balanceamento (`sim.mjs`). */
const PRECO_CAPTURA_MEDIANO = 10 ** (3.04 + 1);

function tabelaDeBolas(c) {
  const linhas = (c.d.catalogoBolas ?? [])
    .map(
      (b) => `<tr>
        <td>${esc(b.nome)}</td>
        <td class="wk-num">×${b.catchRate}</td>
        <td class="wk-num">${P(chanceCapturaWiki(c, PRECO_CAPTURA_FACIL, b.catchRate), c.lang)}</td>
        <td class="wk-num">${b.compravel && b.priceGold ? `${N(b.priceGold, c.lang)} ${c.r.ouro}` : `<em>${c.r.naoComprava}</em>`}</td>
      </tr>`,
    )
    .join('');
  return `${tabela([c.r.bola, c.r.eficiencia, c.r.chanceCorpo, c.r.preco], linhas)}
  <p class="wk-nota">${c.lang === 'en'
    ? 'Catch % is on a fainted body, for the easiest tier (rarity 1). Each species sheet in the Pokédex shows the exact table for that pokémon — the Beast Ball is always <b>2×</b> the Ultra Ball.'
    : c.lang === 'es'
      ? 'La chance es con el cuerpo derrotado, para el tier más fácil (rareza 1). Cada ficha de especie en la Pokédex muestra la tabla exacta — la Beast Ball siempre es <b>2×</b> la Ultra Ball.'
      : 'A chance é no corpo caído, para o tier mais fácil (raridade 1). Cada ficha de espécie na Pokédex mostra a tabela exata — a Beast Ball é sempre <b>2×</b> a Ultra Ball.'}</p>`;
}

function tabelaDePotencia(c) {
  const linhas = (c.d.potencias ?? [])
    .map(
      (p) => `<tr>
        <td class="wk-pot p${p.n}">P${p.n}</td>
        <td class="wk-num">${P(p.chance / 100, c.lang)}</td>
        <td class="wk-num">${p.bonus ? `+${Math.round(p.bonus * 100)}%` : '—'}</td>
      </tr>`,
    )
    .join('');
  return tabela([c.r.tier, c.r.chance, c.r.bonus], linhas);
}

function tabelaDeShiny(c) {
  const ch = Number(c.d.chanceShiny ?? 0);
  const n = Object.keys(c.d.shinyLooks ?? {}).length;
  return `<table class="wk-tabela">
    <thead><tr><th>${c.r.porEncontro}</th><th>${c.r.comIsca}</th></tr></thead>
    <tbody><tr>
        <td class="wk-num">${umEm(ch)}</td>
        <td class="wk-num">${umEm(Math.min(1, ch * 2))}</td>
    </tr></tbody>
  </table>
  <p class="wk-nota">${N(n, c.lang)} ${c.r.especies.toLowerCase()} ${c.lang === 'en' ? 'with a shiny form' : c.lang === 'es' ? 'con forma shiny' : 'com forma shiny'}.</p>`;
}

/**
 * A grade 18×18 de efetividade.
 *
 * Duas leituras na mesma célula: o número BASE (o da série) e, no `title`, o valor já
 * amplificado da hunt. A amplificação é a coisa mais específica deste jogo e a que mais
 * muda uma luta — ×2 vira ×2,5 e ×0,5 vira ×0,33 —, então ela não pode ficar só no texto.
 */
function gradeDeTipos(c) {
  const tab = c.d.tabelaTipos ?? {};
  const amp = c.d.ampliacaoHunt ?? 1.5;
  const curto = c.lang === 'pt' || c.lang === 'es' ? CURTO : CURTO_EN;
  const naHunt = (v) => (v === 0 || v === 1 ? v : v > 1 ? 1 + (v - 1) * amp : v / amp);
  const classe = (v) => (v === 0 ? 'z' : v > 1 ? 'b' : v < 1 ? 'm' : '');
  const mostra = (v) => (v === 0 ? '0' : v === 1 ? '' : String(v).replace('.', ','));

  const cab = `<tr><th class="wk-canto">${c.r.atacante}</th>${T.map(
    (d) => `<th class="wk-col tipo ${d}">${curto[d]}</th>`,
  ).join('')}</tr>`;

  const corpo = T.map((a) => {
    const celulas = T.map((d) => {
      const v = a === d ? 1 : tab[a]?.[d] ?? 1;
      return `<td class="wk-ef ${classe(v)}" title="${curto[a]}→${curto[d]}: ${c.r.base} ×${mostra(v) || 1} · ${c.r.naHunt} ×${String(+naHunt(v).toFixed(2)).replace('.', ',')}">${mostra(v)}</td>`;
    }).join('');
    return `<tr><th class="wk-lin tipo ${a}">${curto[a]}</th>${celulas}</tr>`;
  }).join('');

  return `<div class="wk-rolagem"><table class="wk-tipos">${cab}${corpo}</table></div>`;
}

function tabelaDeAmplificacao(c) {
  const amp = c.d.ampliacaoHunt ?? 1.5;
  const naHunt = (v) => (v === 0 || v === 1 ? v : v > 1 ? 1 + (v - 1) * amp : v / amp);
  const linhas = [0, 0.25, 0.5, 1, 2, 4]
    .map(
      (v) => `<tr>
        <td class="wk-num">×${String(v).replace('.', ',')}</td>
        <td class="wk-num destaque">×${String(+naHunt(v).toFixed(3)).replace('.', ',')}</td>
      </tr>`,
    )
    .join('');
  return tabela([c.r.base, c.r.naHunt], linhas);
}

function tabelaDeQualidade(c) {
  // As bandas são as do catálogo (`formulas.qualidade.bandas`), e o rótulo sai da mesma régua
  // que o jogo usa. Não trafegam para o cliente, mas são CONSTANTES do conteúdo — a fonte
  // está em public/data/index/formulas.json e em MECANICAS.md §3.
  const bandas = [
    [0.8, 0.9, 5], [0.9, 1.0, 5], [1.0, 1.1, 34.03846], [1.1, 1.2, 20], [1.2, 1.3, 10],
    [1.3, 1.4, 10], [1.4, 1.5, 10], [1.5, 1.6, 5], [1.7, 1.8, 0.67308], [1.8, 1.8, 0.28846],
  ];
  const rotulo = (q) =>
    q >= 1.7 ? 'Lendária' : q >= 1.5 ? 'Épica' : q >= 1.3 ? 'Rara' : q >= 1.1 ? 'Incomum' : q >= 1 ? 'Comum' : 'Fraca';
  const rotuloEn = { Fraca: 'Weak', Comum: 'Common', Incomum: 'Uncommon', Rara: 'Rare', Épica: 'Epic', Lendária: 'Legendary' };
  const rotuloEs = { Fraca: 'Débil', Comum: 'Común', Incomum: 'Poco común', Rara: 'Rara', Épica: 'Épica', Lendária: 'Legendaria' };

  const linhas = bandas
    .map(([min, max, ch]) => {
      const r = rotulo(min);
      const nome = c.lang === 'en' ? rotuloEn[r] : c.lang === 'es' ? rotuloEs[r] : r;
      const faixa = min === max ? String(min).replace('.', ',') : `${String(min).replace('.', ',')} – ${String(max).replace('.', ',')}`;
      return `<tr><td>${faixa}</td><td class="wk-num">${P(ch / 100, c.lang)}</td><td>${nome}</td></tr>`;
    })
    .join('');
  return tabela([c.r.qualidade, c.r.chance, c.r.rotulo], linhas);
}

/**
 * A curva do refino: degrau a degrau e acumulado.
 *
 * Os números saem da MESMA conta do servidor (`custoBase` chega no welcome), então a tabela
 * não pode envelhecer sozinha se o balanceamento mudar — que é o defeito que uma tabela
 * escrita à mão num manual sempre acaba tendo.
 */
function tabelaDeRefino(c) {
  const base = c.d.refino?.custoBase ?? 500;
  const degrau = (n) => base * (3 * n * n - 3 * n + 1);
  const total = (n) => base * n ** 3;
  const rot = {
    pt: ['Grau', 'Custo do degrau', 'Total investido'],
    en: ['Step', 'Step cost', 'Total invested'],
    es: ['Escalón', 'Costo del escalón', 'Total invertido'],
  }[c.lang] ?? ['Grau', 'Custo do degrau', 'Total investido'];
  const linhas = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20]
    .map((n) => `<tr><td>+${n}</td><td class="wk-num">${N(degrau(n), c.lang)}</td><td class="wk-num destaque">${N(total(n), c.lang)}</td></tr>`)
    .join('');
  return tabela(rot, linhas);
}

function tabelaDeXp(c) {
  const marcos = [10, 25, 50, 100, 200, 300, 500, 1000, 5000, 10000, 25000, 50000, 100000];
  const linhas = marcos
    .map(
      (L) => `<tr>
        <td class="wk-num">${N(L, c.lang)}</td>
        <td class="wk-num">${N(xpAcumulado(L), c.lang)}</td>
        <td class="wk-num">${N(xpAcumulado(L) - xpAcumulado(L - 1), c.lang)}</td>
      </tr>`,
    )
    .join('');
  return tabela([c.r.nivel, c.r.xpTotal, c.r.custoNivel], linhas);
}

/**
 * A pedra de cada tipo, e o item assinatura que sempre cai junto.
 *
 * Escrita à mão, e não lida do `welcome`, porque é regra de jogo estável: o mapa tipo→pedra
 * mora em `shared/pedras-evolucao.mjs` e a assinatura sai da medição de Kanto/Johto que o
 * gerador de drops usa. Se um dia isso trafegar, troca-se a fonte sem mexer no texto.
 */
const PEDRA_POR_TIPO_DOC = [
  ['NORMAL', 'Sun Stone', 'Rubber Ball'],
  ['FIRE', 'Fire Stone', 'Essence of Fire'],
  ['WATER', 'Water Stone', 'Water Gem'],
  ['GRASS', 'Leaf Stone', 'Seed'],
  ['ELECTRIC', 'Thunder Stone', 'Screw'],
  ['ICE', 'Ice Stone', 'Snowball'],
  ['FIGHTING', 'Punch Stone', 'Band Aid'],
  ['POISON', 'Venom Stone', 'Bottles of Poison'],
  ['GROUND', 'Earth Stone', 'Earth Ball'],
  ['FLYING', 'Feather Stone', '—'],
  ['PSYCHIC', 'Enigma Stone', 'Enchanted Gem'],
  ['BUG', 'Cocoon Stone', 'Bug Gosme'],
  ['ROCK', 'Rock Stone', 'Small Stone'],
  ['GHOST', 'Darkness Stone', 'Ghost Essence'],
  ['DRAGON', 'Ancient Stone', 'Dragon Scale'],
  ['DARK', 'Darkness Stone', 'Dark Gem'],
  ['STEEL', 'Metal Stone', 'Piece of Steel'],
  ['FAIRY', 'Heart Stone', 'Rubber Ball'],
];

/** tipo → pedra → item assinatura, a régua dos drops. */
function tabelaDePedras(c) {
  const linhas = PEDRA_POR_TIPO_DOC.map(
    ([tipo, pedra, item]) => `<tr>
      <td><b>${tipo}</b></td>
      <td>${esc(pedra)}</td>
      <td>${esc(item)}</td>
    </tr>`,
  ).join('');
  return tabela([c.r.tipo, c.r.pedra, c.r.assinatura], linhas);
}

/** Os boosts da loja: um por TIPO, com as sete durações em colunas de preço. */
function tabelaDeBoosts(c) {
  const produtos = (c.d.lojaProdutos ?? []).filter((p) => p.cat === 'boosts');
  if (!produtos.length) return '';
  // Agrupa por nome sem a duração: "XP Boost (2h)" → "XP Boost".
  const grupos = new Map();
  for (const p of produtos) {
    const nome = p.nome.replace(/\s*\(.*\)$/, '');
    const dur = /\(([^)]+)\)$/.exec(p.nome)?.[1] ?? '';
    if (!grupos.has(nome)) grupos.set(nome, { nome, precos: new Map() });
    grupos.get(nome).precos.set(dur, p.preco);
  }
  const duracoes = [...new Set(produtos.map((p) => /\(([^)]+)\)$/.exec(p.nome)?.[1] ?? ''))];

  // A linha de baixo é o MULTIPLICADOR, não a descrição do produto.
  //
  // A descrição vem do catálogo da loja, que é escrito em português e não passa pelo i18n —
  // numa tabela em inglês ela aparecia como "+50% de XP do TREINADOR por 1 hora" no meio das
  // colunas traduzidas. "×1,5" diz a mesma coisa, é exato, e não tem língua. O nome do efeito
  // ("Loot Boost") já é um nome próprio nas três.
  const multDe = (nome) => (c.d.tiposBoost ?? []).find((b) => b.nome === nome)?.mult ?? null;

  const linhas = [...grupos.values()]
    .map((g) => {
      const m = multDe(g.nome);
      const sub = m ? `<em class="wk-sub">×${String(m).replace('.', c.lang === 'en' ? '.' : ',')}</em>` : '';
      return `<tr>
        <td>${esc(g.nome)}${sub}</td>
        ${duracoes.map((d) => `<td class="wk-num">${g.precos.has(d) ? N(g.precos.get(d), c.lang) : '—'}</td>`).join('')}
      </tr>`;
    })
    .join('');
  return tabela([c.r.efeito, ...duracoes.map((d) => `${d} ${c.r.diamantes}`)], linhas, 'wk-larga');
}

/**
 * Os produtos de uma categoria da loja, com preço e descrição.
 *
 * A descrição é a DELES, em português, e sai do catálogo sem passar pelo i18n — é a mesma
 * frase que o card da Loja mostra. Manter as duas telas dizendo exatamente a mesma coisa vale
 * mais aqui do que traduzir uma e deixar a outra: o jogador vai comparar o manual com o botão
 * que ele vai clicar, e uma frase diferente entre os dois vira dúvida sobre qual está certa.
 */
function tabelaDaLoja(c, cat) {
  // O catálogo chega do servidor em português, com a chave de tradução ao lado (`i18n`). Quem
  // traduz é a vitrine (`textoDaLoja`, no app.js), que manda a função junto dos dados; sem ela
  // (um teste, por exemplo) fica o texto do servidor.
  const traduzir = (chave, p, pronto) => c.d.textoDaLoja?.(chave, p.i18n?.params, pronto) ?? pronto;
  const linhas = (c.d.lojaProdutos ?? [])
    .filter((p) => p.cat === cat)
    .map(
      (p) => `<tr>
        <td>${esc(traduzir(p.i18n?.nome, p, p.nome))}</td>
        <td class="wk-num">${N(p.preco, c.lang)} ${c.r.diamantes}</td>
        <td class="wk-desc">${esc(traduzir(p.i18n?.desc, p, p.descricao ?? ''))}</td>
      </tr>`,
    )
    .join('');
  return tabela([c.r.item, c.r.preco, c.r.efeito], linhas);
}

/** Os bosses desafiáveis: entrada, nível e o que cai. */
function tabelaDeBosses(c) {
  const linhas = (c.d.bossesJogaveis ?? [])
    .map((b) => {
      const drops = b.drops
        .map((d) => `${esc(d.nome)}${d.chance ? ` (${P(d.chance, c.lang)})` : d.qtd ? ` ×${d.qtd[0]}–${d.qtd[1]}` : ''}`)
        .join(' · ');
      return `<tr>
        <td>${esc(b.nome)}</td>
        <td class="wk-num">${N(b.level, c.lang)}</td>
        <td class="wk-num">${N(b.teamLevel, c.lang)}</td>
        <td class="wk-desc">${drops}</td>
      </tr>`;
    })
    .join('');
  return tabela(
    [c.lang === 'pt' ? 'Boss' : 'Boss', c.r.nivel, c.lang === 'pt' ? 'Nível de equipe' : c.lang === 'es' ? 'Nivel de equipo' : 'Team level', 'Drops'],
    linhas,
  );
}

/**
 * De onde vem uma peça de TM: quantos bosses a soltam e a faixa de chance, lidos da mesma tabela
 * de drops (`bossesJogaveis`) com que o servidor sorteia. Antes do welcome, `null`.
 */
function fontesDaPeca(c, itemId) {
  const chances = (c.d.bossesJogaveis ?? []).flatMap((b) =>
    (b.drops ?? []).filter((d) => d.itemId === itemId && d.chance).map((d) => d.chance));
  if (!chances.length) return null;
  const min = Math.min(...chances);
  const max = Math.max(...chances);
  return { bosses: chances.length, faixa: min === max ? P(min, c.lang) : `${P(min, c.lang)}–${P(max, c.lang)}` };
}

/** "13 bosses (0,50%–6,50%)" — a coluna "Vem de" da tabela de peças. */
const origemDaPeca = (c, itemId) => {
  const f = fontesDaPeca(c, itemId);
  return f ? `${N(f.bosses, c.lang)} bosses (${f.faixa})` : '—';
};
const idPecaElemental = (c) => c.d.tmResearcher?.pieceElemental ?? 59194;
const idPecaAoe = (c) => c.d.tmResearcher?.pieceAoe ?? 40530;
const pecasPorDisco = (c) => N(c.d.tmResearcher?.custoElemental ?? 10, c.lang);

/** Quantos pokémon no nível do boss zeram a penalidade (`BOSS_EQUIPE_IDEAL`, vem no welcome). */
const equipeIdealBoss = (c) => c.d.bossesJogaveis?.[0]?.equipeIdeal ?? 5;

/** O multiplicador de dano recebido por uma equipe de força `forca` — a conta de `penalidadeDeEquipe`. */
const multPenalidadeBoss = (c, forca) => BASE_PENALIDADE_BOSS ** Math.max(0, equipeIdealBoss(c) - forca);

/** A tabela da penalidade de equipe, montada pela mesma conta do servidor. */
function tabelaPenalidadeBoss(c) {
  const ideal = equipeIdealBoss(c);
  const L = {
    pt: {
      cab: ['Equipe', 'Multiplicador de dano recebido'],
      noNivel: (n) => (n === ideal ? `${n} ou mais pokémon no nível do boss` : `${n} pokémon no nível do boss`),
      metade: '1 pokémon com metade do nível do boss',
      teto: '1 pokémon muito abaixo do boss',
      ate: 'até',
    },
    en: {
      cab: ['Team', 'Incoming damage multiplier'],
      noNivel: (n) => (n === ideal ? `${n} or more pokémon at the boss level` : `${n} pokémon at the boss level`),
      metade: '1 pokémon at half the boss level',
      teto: '1 pokémon far below the boss',
      ate: 'up to',
    },
    es: {
      cab: ['Equipo', 'Multiplicador de daño recibido'],
      noNivel: (n) => (n === ideal ? `${n} o más pokémon al nivel del boss` : `${n} pokémon al nivel del boss`),
      metade: '1 pokémon con la mitad del nivel del boss',
      teto: '1 pokémon muy por debajo del boss',
      ate: 'hasta',
    },
  }[c.lang];
  const x = (v) => `×${N(Math.round(v), c.lang)}`;
  const degraus = [...new Set([ideal, ideal - 1, ideal - 2, 1])].filter((n) => n >= 1);
  const linhas = [
    ...degraus.map((n, i) => `<tr><td>${L.noNivel(n)}</td><td class="wk-num${i === 0 ? ' destaque' : ''}">${x(multPenalidadeBoss(c, n))}</td></tr>`),
    `<tr><td>${L.metade}</td><td class="wk-num">${x(multPenalidadeBoss(c, 0.5))}</td></tr>`,
    `<tr><td>${L.teto}</td><td class="wk-num">${L.ate} ${x(multPenalidadeBoss(c, 0))}</td></tr>`,
  ].join('');
  return tabela(L.cab, linhas);
}

/** As linhas da tabela de prêmios da guild: o bônus do ranking Diário e os diamantes do Global. */
function linhasPremiosGuild(c) {
  const pos = {
    pt: ['1º', '2º', '3º', '4º em diante (com GP &gt; 0)'],
    en: ['1st', '2nd', '3rd', '4th onward (GP &gt; 0)'],
    es: ['1.º', '2.º', '3.º', '4.º en adelante (GP &gt; 0)'],
  }[c.lang];
  return [1, 2, 3, 'resto'].map((k, i) => `<tr>
      <td>${pos[i]}</td>
      <td class="wk-num${i === 0 ? ' destaque' : ''}">+${BONUS_RANKING_GP[k]}%</td>
      <td class="wk-num">${PREMIOS_GLOBAL[k] ? `${N(PREMIOS_GLOBAL[k], c.lang)} 💎` : '—'}</td>
    </tr>`).join('');
}

/** Quanto rende DOBRAR o nível na Guerra de Guilds, em % — a compressão acima do nível cheio. */
const DOBRA_NA_GUERRA_PCT = Math.round((2 ** ARENA_EXPO_GUERRA - 1) * 100);

/** A última aba do Mapa — a mais alta da escada. */
const ULTIMA_REGIAO = REGIOES_MAPA_DOC.at(-1);

/** A hunt de nível mais alto que o servidor mandou — 0 antes do welcome. */
const huntMaisAlta = (c) => (c.d.hunts ?? []).reduce((m, h) => Math.max(m, Number(h.nivel) || 0), 0);

/** O quadro de TAXAS: tudo que o jogo desconta, num lugar só. */
function tabelaDeTaxas(c) {
  const e = c.d.economia ?? {};
  const L = {
    pt: [
      ['Mercado da Comunidade — anúncio em Gema', `${e.taxaMercadoOrbPct}% sobre a venda`, 'o VENDEDOR'],
      ['Mercado da Comunidade — anúncio em Ouro', `${e.taxaMercadoGoldPct ?? 10}% sobre a venda`, 'o VENDEDOR'],
      ['Mercado da Comunidade — pensão do pokémon', `${(e.taxaDiariaMercado ?? 100000).toLocaleString("pt-BR")} Coins por dia (só pokémon)`, 'o VENDEDOR'],
      ['Market (NPC) — comprar', 'nenhuma', '—'],
      ['Market (NPC) — vender', 'nenhuma (paga o valor cheio do catálogo)', '—'],
      ['Gema — compra com USDT', `US$ ${e.orbCompraUsdt} por Gema`, 'o comprador'],
      ['Gema — saque em USDT', `US$ ${e.orbSaqueUsdt} por Gema (spread de ${e.spreadPct}%)`, 'quem saca'],
      ['Gema — taxa de rede do saque', 'por conta do projeto', '—'],
      ['Loja de Diamantes', 'nenhuma (o preço é o final)', '—'],
      ['Nocaute — o time inteiro cai (hunt ou boss)', `${e.xpPerdidoPct ?? 10}% do XP do nível atual (a Bless reduz ou zera)`, 'quem cai'],
    ],
    en: [
      ['Community Market — Gem listing', `${e.taxaMercadoOrbPct}% of the sale`, 'the SELLER'],
      ['Community Market — Gold listing', `${e.taxaMercadoGoldPct ?? 10}% of the sale`, 'the SELLER'],
      ['Community Market — pokémon boarding', `${(e.taxaDiariaMercado ?? 100000).toLocaleString("en-US")} Coins a day (pokémon only)`, 'the SELLER'],
      ['Market (NPC) — buying', 'none', '—'],
      ['Market (NPC) — selling', 'none (pays the full catalogue value)', '—'],
      ['Gem — buying with USDT', `US$ ${e.orbCompraUsdt} per Gem`, 'the buyer'],
      ['Gem — withdrawing to USDT', `US$ ${e.orbSaqueUsdt} per Gem (${e.spreadPct}% spread)`, 'whoever withdraws'],
      ['Gem — withdrawal network fee', 'paid by the project', '—'],
      ['Diamond Shop', 'none (the price is final)', '—'],
      ['Knockout — the whole team falls (hunt or boss)', `${e.xpPerdidoPct ?? 10}% of the current level's XP (Bless reduces or cancels it)`, 'whoever falls'],
    ],
    es: [
      ['Mercado de la Comunidad — anuncio en Gemas', `${e.taxaMercadoOrbPct}% sobre la venta`, 'el VENDEDOR'],
      ['Mercado de la Comunidad — anuncio en Oro', `${e.taxaMercadoGoldPct ?? 10}% sobre la venta`, 'el VENDEDOR'],
      ['Mercado de la Comunidad — pensión del pokémon', `${(e.taxaDiariaMercado ?? 100000).toLocaleString("es-ES")} Coins por día (solo pokémon)`, 'el VENDEDOR'],
      ['Market (NPC) — comprar', 'ninguna', '—'],
      ['Market (NPC) — vender', 'ninguna (paga el valor completo del catálogo)', '—'],
      ['Gema — compra con USDT', `US$ ${e.orbCompraUsdt} por Gema`, 'el comprador'],
      ['Gema — retiro en USDT', `US$ ${e.orbSaqueUsdt} por Gema (spread del ${e.spreadPct}%)`, 'quien retira'],
      ['Gema — comisión de red del retiro', 'a cargo del proyecto', '—'],
      ['Tienda de Diamantes', 'ninguna (el precio es final)', '—'],
      ['Nocaut — cae el equipo entero (cacería o boss)', `${e.xpPerdidoPct ?? 10}% del XP del nivel actual (la Bless lo reduce o anula)`, 'quien cae'],
    ],
  }[c.lang];

  return tabela(
    [c.r.taxa, c.r.quanto, c.r.quemPaga],
    L.map(([a, b, d]) => `<tr><td>${a}</td><td class="wk-num">${b}</td><td>${d}</td></tr>`).join(''),
  );
}

// ------------------------------------------------------------- capítulos
//
// A ordem é a do JOGADOR, não a do código: começa no que ele vê no primeiro minuto e só
// depois desce para o que só importa quando ele já tem um time. Dinheiro de verdade fica no
// fim, que é onde a pessoa chega quando já entendeu o resto.

export const CAPITULOS = [
  // ------------------------------------------------------------ 1. começo
  {
    id: 'inicio',
    titulo: { pt: 'Primeiros passos', en: 'Getting started', es: 'Primeros pasos' },
    grupo: 'basico',
    html: (c) => ({
      pt: `
        <p>Pokéidle é um <b>idle</b>: o seu pokémon luta sozinho. Você escolhe onde caçar,
        com quem, e o que fazer com o que cair. O jogo continua enquanto a aba estiver aberta.</p>

        <h4>O laço de sempre</h4>
        <ol class="wk-passos">
          <li><b>Abra o Mapa</b> e escolha uma área. Cada uma tem um nível recomendado — o do
          pokémon mais forte que aparece lá. Área acima do seu nível fica trancada.</li>
          <li><b>O seu pokémon ativo</b> anda até o selvagem mais próximo e começa a bater.
          Você não clica em nada durante a luta.</li>
          <li><b>Derrubado, o selvagem vira corpo</b> e fica <b>30 segundos</b> no chão. É nesse
          intervalo que se joga a pokébola — e é assim que se captura de verdade
          (ver <a data-cap="captura">Captura</a>).</li>
          <li><b>O que cai</b> vai para a Bolsa; o ouro entra direto. Venda o que não usar no
          <a data-cap="market">Market</a>.</li>
        </ol>

        <h4>A sua equipe</h4>
        <p>Cabem <b>${c.d.maxEquipe}</b> pokémon na equipe. Quem for capturado com ela cheia cai
        no <b>Depot</b>, que não tem limite. Só um luta por vez — o <b>ativo</b> —, e quando ele
        desmaia o próximo da equipe entra no lugar automaticamente.</p>

        ${nota(`<b>O starter não é sorteado como os outros.</b> Ele nasce com piso de qualidade
        e de IV justamente para dar conta da primeira hunt. Um pokémon capturado gira a roleta
        inteira — ver <a data-cap="stats">Stats e Qualidade</a>.`)}

        <h4>Quando tudo dá errado</h4>
        <p>Se o time inteiro cair, você acorda na praça do <b>Centro Pokémon</b>. A Enfermeira
        Joy cura de graça; sair de lá é escolher outra área no Mapa. Detalhes em
        <a data-cap="morte">Desmaiar</a>.</p>

        <h4>Chamar alguém pelo nome</h4>
        <p>Escreva <b>@</b> colado no nick da pessoa — <b>@ash oi</b> ou <b>eaiii @ash</b> — e o
        nome vira uma etiqueta na fala. Para quem foi chamado, a linha inteira acende no chat: é
        assim que uma resposta deixa de se perder na rolagem quando a conversa anda depressa.</p>

        <h4>Mensagens privadas</h4>
        <p>Para conversar em privado com alguém, use a <b>Lista de Amigos</b>. O chat Mundo e
        Guild continuam públicos. No painel de um amigo, <b>Ver perfil</b> abre a ficha dele por
        cima da conversa; fechar a ficha devolve você ao papo.</p>

        <h4>O ritmo do chat</h4>
        <p>O chat Mundo e o da Guild aceitam <b>uma mensagem a cada ${SEG_CHAT} segundos</b>. A
        espera é da <b>conta</b>: recarregar a página ou reconectar não a zera.</p>

        <h4>Comandos do chat</h4>
        <p>Digite no chat para receber uma resposta que <b>só você vê</b> — ela não é publicada
        para ninguém.</p>
        <ul>
          <li><b>/site</b> — o site de hunts X4 feito pela comunidade.</li>
          <li><b>/ticket</b> — o convite do Discord e a sala de suporte, onde se reportam bugs
          (há recompensa em diamantes por bug bounty e vulnerabilidade).</li>
          <li><b>/guia</b> — o guia do jogo, para começar e evoluir.</li>
        </ul>
`,
      en: `
        <p>Pokéidle is an <b>idle game</b>: your pokémon fights on its own. You choose where to
        hunt, with whom, and what to do with the loot. The game runs while the tab is open.</p>

        <h4>The core loop</h4>
        <ol class="wk-passos">
          <li><b>Open the Map</b> and pick an area. Each one has a recommended level — that of
          the strongest species spawning there. Areas above your level stay locked.</li>
          <li><b>Your active pokémon</b> walks to the nearest wild and starts hitting it. You
          click nothing during the fight.</li>
          <li><b>Once knocked down, the wild becomes a body</b> and stays on the ground for
          <b>30 seconds</b>. That is the window to throw a ball — and that is how you actually
          catch things (see <a data-cap="captura">Catching</a>).</li>
          <li><b>Loot</b> goes to the Bag; gold goes straight in. Sell what you don't need at the
          <a data-cap="market">Market</a>.</li>
        </ol>

        <h4>Your team</h4>
        <p>The team holds <b>${c.d.maxEquipe}</b> pokémon. Anything caught with a full team drops
        into the <b>Depot</b>, which has no limit. Only one fights at a time — the <b>active</b>
        one — and when it faints the next team member steps in automatically.</p>

        ${nota(`<b>The starter is not rolled like the others.</b> It is born with a quality and
        IV floor precisely so it can survive the first hunt. A caught pokémon spins the full
        wheel — see <a data-cap="stats">Stats and Quality</a>.`)}

        <h4>When it all goes wrong</h4>
        <p>If the whole team falls, you wake up in the <b>Pokémon Center</b> square. Nurse Joy
        heals for free; leaving means picking another area on the Map. Details in
        <a data-cap="morte">Fainting</a>.</p>

        <h4>Chat commands</h4>
        <p>Type them in chat to get an answer <b>only you can see</b> — nothing is published to
        anyone else.</p>
        <ul>
          <li><b>/site</b> — the community-made X4 hunt site.</li>
          <li><b>/ticket</b> — the Discord invite and the support room, where bugs are reported
          (there are diamond rewards for bug bounties and vulnerabilities).</li>
          <li><b>/guia</b> — the game guide, to get started and progress.</li>
        </ul>

        <h4>Calling someone by name</h4>
        <p>Write <b>@</b> right before the nick — <b>@ash hi</b> or <b>hey @ash</b> — and the name
        becomes a tag in the message. For the person called, the whole line lights up in chat:
        that is how an answer stops getting lost in the scroll when the room is busy.</p>

        <h4>Private messages</h4>
        <p>To talk privately with someone, use the <b>Friends List</b>. World and Guild chat
        stay public. In a friend's panel, <b>View profile</b> opens their sheet on top of the
        conversation; closing the sheet takes you back to the chat.</p>

        <h4>Chat pace</h4>
        <p>World and Guild chat take <b>one message every ${SEG_CHAT} seconds</b>. The wait belongs
        to the <b>account</b>: reloading the page or reconnecting does not reset it.</p>
`,
      es: `
        <p>Pokéidle es un <b>idle</b>: tu pokémon pelea solo. Tú eliges dónde cazar, con quién y
        qué hacer con lo que caiga. El juego sigue mientras la pestaña esté abierta.</p>

        <h4>El bucle de siempre</h4>
        <ol class="wk-passos">
          <li><b>Abre el Mapa</b> y elige una zona. Cada una tiene un nivel recomendado — el del
          pokémon más fuerte que aparece allí. Las zonas por encima de tu nivel están bloqueadas.</li>
          <li><b>Tu pokémon activo</b> camina hasta el salvaje más cercano y empieza a golpear.
          No haces clic en nada durante el combate.</li>
          <li><b>Al caer, el salvaje queda como cuerpo</b> durante <b>30 segundos</b>. Ese es el
          momento de lanzar la poké ball — y así es como se captura de verdad
          (ver <a data-cap="captura">Captura</a>).</li>
          <li><b>Lo que cae</b> va a la Bolsa; el oro entra directo. Vende lo que no uses en el
          <a data-cap="market">Market</a>.</li>
        </ol>

        <h4>Tu equipo</h4>
        <p>Caben <b>${c.d.maxEquipe}</b> pokémon en el equipo. Lo que captures con el equipo lleno
        cae en el <b>Depot</b>, que no tiene límite. Solo uno pelea a la vez — el <b>activo</b> — y
        cuando se debilita entra el siguiente automáticamente.</p>

        ${nota(`<b>El inicial no se sortea como los demás.</b> Nace con un mínimo de calidad e IV
        justamente para aguantar la primera cacería. Un pokémon capturado gira la ruleta
        completa — ver <a data-cap="stats">Stats y Calidad</a>.`)}

        <h4>Cuando todo sale mal</h4>
        <p>Si cae el equipo entero, despiertas en la plaza del <b>Centro Pokémon</b>. La Enfermera
        Joy cura gratis; salir de allí es elegir otra zona en el Mapa. Detalles en
        <a data-cap="morte">Debilitarse</a>.</p>

        <h4>Comandos del chat</h4>
        <p>Escríbelos en el chat para recibir una respuesta que <b>solo tú ves</b> — no se publica
        para nadie más.</p>
        <ul>
          <li><b>/site</b> — el sitio de hunts X4 hecho por la comunidad.</li>
          <li><b>/ticket</b> — la invitación de Discord y la sala de soporte, donde se reportan
          bugs (hay recompensas en diamantes por bug bounty y vulnerabilidades).</li>
          <li><b>/guia</b> — la guía del juego, para empezar y avanzar.</li>
        </ul>

        <h4>Llamar a alguien por su nombre</h4>
        <p>Escribe <b>@</b> pegado al nick — <b>@ash hola</b> o <b>ey @ash</b> — y el nombre se
        convierte en una etiqueta dentro del mensaje. A quien llamaste se le enciende la línea
        entera en el chat: así una respuesta no se pierde en el scroll cuando la sala va rápido.</p>

        <h4>Mensajes privados</h4>
        <p>Para hablar en privado con alguien, usa la <b>Lista de Amigos</b>. El chat Mundo y
        Guild siguen siendo públicos. En el panel de un amigo, <b>Ver perfil</b> abre su ficha
        encima de la conversación; al cerrar la ficha vuelves a la charla.</p>

        <h4>El ritmo del chat</h4>
        <p>El chat Mundo y el de Guild aceptan <b>un mensaje cada ${SEG_CHAT} segundos</b>. La
        espera es de la <b>cuenta</b>: recargar la página o reconectar no la reinicia.</p>
`,
    }),
  },

  // ------------------------------------------------------------- 2. níveis
  {
    id: 'niveis',
    titulo: { pt: 'Níveis e XP', en: 'Levels and XP', es: 'Niveles y XP' },
    grupo: 'basico',
    html: (c) => ({
      pt: `
        <p>Há <b>dois níveis independentes</b>: o do <b>treinador</b> (você) e o do <b>pokémon
        ativo</b>. Cada derrota paga o mesmo XP para os dois, e cada um sobe na própria conta.</p>
        <ul>
          <li>O nível do <b>treinador</b> é o que <b>destranca as áreas</b> do Mapa.</li>
          <li>O nível do <b>pokémon</b> é o que faz os stats dele crescerem — e ele
          <b>cura por completo</b> a cada nível novo.</li>
        </ul>

        <h4>A curva</h4>
        <p>É cúbica, e não tem teto. Subir sempre custa mais que o nível anterior:</p>
        <pre class="wk-formula">xpTotal(L) = arred( 50/3 × (L³ − 6L² + 17L − 12) )</pre>
        ${tabelaDeXp(c)}
        ${nota(`<b>Não existe nível máximo.</b> A curva só fica mais cara — ${ULTIMA_REGIAO.rotulo.pt}, a
        última aba do Mapa, abre no <b>nv ${N(ULTIMA_REGIAO.nivel, c.lang)}</b> do treinador${huntMaisAlta(c)
          ? `, e a hunt mais alta de hoje pede <b>nv ${N(huntMaisAlta(c), c.lang)}</b>` : ''}. Um
        pokémon nível 1000 já é caro; o topo do Mapa é meta de fim de jogo, não de primeira
        semana.`)}

        <h4>O que multiplica o seu XP</h4>
        <ul>
          <li><b>XP Boost</b> — +50% no XP do TREINADOR.</li>
          <li><b>XP Boost Pokémon</b> — +50% no XP do POKÉMON.</li>
          <li><b>VIP</b> — +50% nos dois.</li>
        </ul>
        <p>Eles se <b>multiplicam</b>, não se somam: VIP + XP Boost dá <b>2,25×</b>, e não 2×.
        São compras separadas, e somar faria a segunda valer menos que a primeira justamente
        para quem gastou mais. Ver <a data-cap="loja">Loja de Diamantes</a>.</p>`,
      en: `
        <p>There are <b>two independent levels</b>: the <b>trainer's</b> (yours) and the
        <b>active pokémon's</b>. Every kill pays the same XP to both, and each climbs its own
        curve.</p>
        <ul>
          <li>The <b>trainer</b> level is what <b>unlocks Map areas</b>.</li>
          <li>The <b>pokémon</b> level is what grows its stats — and it <b>fully heals</b> on
          every level-up.</li>
        </ul>

        <h4>The curve</h4>
        <p>It is cubic, and there is no cap. Every level costs more than the last:</p>
        <pre class="wk-formula">totalXp(L) = round( 50/3 × (L³ − 6L² + 17L − 12) )</pre>
        ${tabelaDeXp(c)}
        ${nota(`<b>There is no level cap.</b> The curve just gets more expensive — ${ULTIMA_REGIAO.rotulo.en},
        the last Map tab, unlocks at trainer <b>Lv ${N(ULTIMA_REGIAO.nivel, c.lang)}</b>${huntMaisAlta(c)
          ? `, and today's highest hunt asks for <b>Lv ${N(huntMaisAlta(c), c.lang)}</b>` : ''}.
        Level 1000 is already costly; the top of the Map is endgame, not week one.`)}

        <h4>What multiplies your XP</h4>
        <ul>
          <li><b>XP Boost</b> — +50% to TRAINER XP.</li>
          <li><b>Pokémon XP Boost</b> — +50% to POKÉMON XP.</li>
          <li><b>VIP</b> — +50% to both.</li>
        </ul>
        <p>They <b>multiply</b> rather than add: VIP + XP Boost is <b>2.25×</b>, not 2×. They are
        separate purchases, and adding them would make the second one worth less than the first
        precisely for whoever spent more. See <a data-cap="loja">Diamond Shop</a>.</p>`,
      es: `
        <p>Hay <b>dos niveles independientes</b>: el del <b>entrenador</b> (tú) y el del
        <b>pokémon activo</b>. Cada derrota paga el mismo XP a los dos, y cada uno sube por su
        cuenta.</p>
        <ul>
          <li>El nivel del <b>entrenador</b> es el que <b>desbloquea las zonas</b> del Mapa.</li>
          <li>El nivel del <b>pokémon</b> es el que hace crecer sus stats — y se <b>cura por
          completo</b> en cada nivel nuevo.</li>
        </ul>

        <h4>La curva</h4>
        <p>Es cúbica y no tiene tope. Subir siempre cuesta más que el nivel anterior:</p>
        <pre class="wk-formula">xpTotal(L) = redondear( 50/3 × (L³ − 6L² + 17L − 12) )</pre>
        ${tabelaDeXp(c)}
        ${nota(`<b>No existe nivel máximo.</b> La curva solo se encarece — ${ULTIMA_REGIAO.rotulo.es}, la
        última pestaña del Mapa, se abre en <b>nv ${N(ULTIMA_REGIAO.nivel, c.lang)}</b> del
        entrenador${huntMaisAlta(c)
          ? `, y la cacería más alta de hoy pide <b>nv ${N(huntMaisAlta(c), c.lang)}</b>` : ''}. Nivel
        1000 ya es caro; la cima del Mapa es meta de final de juego, no de la primera semana.`)}

        <h4>Qué multiplica tu XP</h4>
        <ul>
          <li><b>XP Boost</b> — +50% al XP del ENTRENADOR.</li>
          <li><b>XP Boost Pokémon</b> — +50% al XP del POKÉMON.</li>
          <li><b>VIP</b> — +50% a los dos.</li>
        </ul>
        <p>Se <b>multiplican</b>, no se suman: VIP + XP Boost da <b>2,25×</b>, no 2×. Son compras
        distintas, y sumarlas haría que la segunda valiera menos que la primera justamente para
        quien más gastó. Ver <a data-cap="loja">Tienda de Diamantes</a>.</p>`,
    }),
  },

  // -------------------------------------------------------------- 3. stats
  {
    id: 'stats',
    titulo: { pt: 'Stats, Qualidade e IV', en: 'Stats, Quality and IV', es: 'Stats, Calidad e IV' },
    grupo: 'basico',
    html: (c) => ({
      pt: `
        <p>Dois pokémon da mesma espécie e do mesmo nível quase nunca são iguais. O que os
        separa são três números sorteados <b>na captura</b> e que <b>nunca mais mudam</b>:
        <b>qualidade</b>, <b>IV</b> e <b>potência</b>.</p>

        <pre class="wk-formula">stat = arred( (base + 2 × IV) × nível/100 × qualidade^expoente × multiplicador )
somaStats = hp + atk + def + spAtk + spDef + speed</pre>

        <h4>IV — 1 a 32 por stat</h4>
        <p>Seis sorteios independentes, de <b>1 a 32</b> cada (máximo somado: 192). Evoluir
        <b>não</b> rerola nada.</p>

        <h4>IV de SPD — cooldown, não corrida</h4>
        <p>O <b>IV de Velocidade (SPD)</b> é sorteado separado, como os outros cinco. Ele
        <b>não</b> entra na fórmula de dano nem acelera a corrida na hunt — o pokémon sempre
        corre um pouco na frente do treinador por design da cena. O que muda é o
        <b>cooldown</b> de golpes: <b>−0,01 s por ponto de IV</b> (IV 1 → −0,01 s; IV 32 →
        −0,32 s), fixo no nascimento, em todo cooldown (global e de cada golpe). Sp.ATK e Sp.DEF
        só entram em golpes <b>especiais</b>.</p>

        <h4>Qualidade — o número que mais pesa</h4>
        <p>Ela entra em <b>cada stat</b> como expoente (<code>qualidade^expo</code>) — por isso
        muda o bicho inteiro e vale mais que o IV isolado. A linha <code>somaStats</code> acima é
        só a <b>soma dos seis stats</b> (útil na Pokédex para comparar potências). A <b>nota</b> e
        o <b>⚔</b> usam essa força de nascimento — ver <a data-cap="nota">Nota, Poder e Calculadora</a>.</p>
        <h4>Como nasce a qualidade</h4>
        <p><b>Não é calculada</b> a partir dos IVs, da potência, do shiny nem do nível. Na captura
        o jogo sorteia <b>uma faixa</b> (pelas chances da tabela abaixo) e, dentro dela, um valor
        aleatório entre o mínimo e o máximo — com três casas decimais. Esse número fica para
        sempre; evoluir não muda nada.</p>
        ${nota(`Um pokémon com IV no teto e potência V pode nascer com q<b>1,0</b> (Comum) ou
        q<b>1,7</b> (Lendária): são três sorteios <b>independentes</b> na mesma captura. IV alto
        <b>não</b> puxa a qualidade para cima.`)}
        ${tabelaDeQualidade(c)}
        ${nota(`A faixa <b>1,6 – 1,7 é um buraco intencional</b>: nenhum pokémon nasce nela. O
        teto do sorteio é exatamente <b>1,8</b> (~0,29% de chance). O shiny não ganha qualidade
        extra — ele fica mais forte pelo <b>×${c.d.multShinyStats ?? 3} nos stats</b> e pelos IVs rerolados, não por um q
        maior.`)}
        <p>O expoente muda por stat: <b>0,95</b> para HP e Velocidade, <b>0,8</b> para os
        outros quatro. O efeito do <b>IV de SPD</b> no combate (cooldown, não corrida) está em
        <a data-cap="combate">Combate</a>.</p>

        <h4>HP de combate</h4>
        <pre class="wk-formula">hpDeCombate = máx(24, arred(hp × 12))</pre>
        <p>Um selvagem ainda leva <b>×${c.d.multHpSelvagem ?? 5}</b> por cima disso — ver
        <a data-cap="combate">Combate</a>.</p>

        <h4>Refino — o “+1” comprado com pedra</h4>
        <p>É o único jeito de mexer na <b>base</b> de um pokémon depois que ele nasceu. Cada
        degrau soma <b>+${c.d.refino?.passo ?? 1}</b> permanente a um stat-base, e o ganho entra
        <b>antes</b> de tudo o mais na fórmula lá em cima — ou seja, é multiplicado por nível,
        qualidade e potência. O mesmo degrau que vale +1 num nível 100 comum vale quatro vezes
        isso num P5 shiny.</p>
        <p>Você paga na <b>pedra de evolução do tipo do próprio pokémon</b> — a mesma com que ele
        evolui, e a comum mesmo se ele for shiny. Forma final também refina: o Dragonite não
        evolui para lugar nenhum, mas usa Ancient Stone como qualquer outro DRAGON.</p>
<pre class="wk-formula">ter +N num stat  = ${N(c.d.refino?.custoBase ?? 500, c.lang)} × N³ pedras, somando tudo
custo do degrau N = ${N(c.d.refino?.custoBase ?? 500, c.lang)} × (3N² − 3N + 1)</pre>
        ${tabelaDeRefino(c)}
        ${nota(`<b>Não há teto.</b> Quem quiser continuar subindo, sobe — quem decide o ritmo é o
        preço. A curva é cúbica, e não exponencial, exatamente por isso: dobrando, o vigésimo
        degrau custaria 262 milhões de pedras e existiria um teto de fato escondido na fórmula.`)}
        ${nota(`O custo é <b>por stat</b>, não por pokémon. Quem colocou quatro degraus no HP paga
        ${N(30500, c.lang)} pelo quinto — mas o
        primeiro de ATK continua custando ${N(c.d.refino?.custoBase ?? 500, c.lang)}. Refinar é
        <b>escolher</b> onde o bicho vai ser bom, não encher uma barra.`)}
        <p><b>O SPD não refina</b>, e não é esquecimento: o stat de SPD não entra em combate
        nenhum — quem decide a cadência de ataque é o <b>IV</b> de Speed, ali em cima. Vender
        “+1 SPD” seria vender um número que não faz nada.</p>
        <p>A <b>nota N=</b> e o <b>⚔</b> sobem com o refino — usam a base atual (espécie + +N).
        TM elemental e held items não entram na nota. O selo <b>+N</b> ao lado do nome mostra
        quanto já foi investido; os stats de verdade sobem na ficha.</p>
        <p>O “+” fica em dois lugares: no cabeçalho do painel <b>Em campo</b> e em cada linha de
        <b>Stats-base</b> na ficha de um pokémon seu. Refinar manda o pokémon para a sua
        <a data-cap="market">Coleção</a>, fora da venda ao NPC — devolva ao Depot se quiser mesmo
        vendê-lo.</p>

        <h4>O piso do starter</h4>
        <p>O primeiro pokémon <b>não</b> passa pelo sorteio livre. Ele nasce com qualidade
        <b>≥ 1,30</b>, soma de IVs <b>&gt; 140</b> e nenhum IV abaixo de <b>16</b>. Sem isso, um
        em cada dez treinadores começaria com um bicho da banda "Fraca" e a primeira hunt seria
        intransponível.</p>`,
      en: `
        <p>Two pokémon of the same species and level are almost never the same. What sets them
        apart are three numbers rolled <b>at capture</b> that <b>never change again</b>:
        <b>quality</b>, <b>IV</b> and <b>potency</b>.</p>

        <pre class="wk-formula">stat = round( (base + 2 × IV) × level/100 × quality^exponent × multiplier )
statSum = hp + atk + def + spAtk + spDef + speed</pre>

        <h4>IV — 1 to 32 per stat</h4>
        <p>Six independent rolls, <b>1 to 32</b> each (max total: 192). Evolving does
        <b>not</b> reroll anything.</p>

        <h4>SPD IV — cooldown, not running speed</h4>
        <p><b>Speed IV (SPD)</b> is rolled separately, like the other five. It does <b>not</b>
        enter the damage formula or make the pokémon run faster on the hunt map — the active
        pokémon is always slightly ahead of the trainer by scene design. What it shortens is
        <b>move cooldowns</b>: <b>−0.01 s per IV point</b> (IV 1 → −0.01 s; IV 32 → −0.32 s),
        fixed at birth, on every cooldown (global gap and each move). Sp.ATK and Sp.DEF only
        matter on <b>special</b> moves.</p>

        <h4>Quality — the number that weighs most</h4>
        <p>It enters <b>each stat</b> as an exponent (<code>quality^exp</code>) — so it shifts the
        whole pokémon and matters more than IV alone. The <code>statSum</code> line above is just
        the <b>sum of the six stats</b> (used in the Pokédex to compare potencies). The <b>score</b>
        and <b>⚔</b> use that birth strength — see <a data-cap="nota">Score, Power and Calculator</a>.</p>
        <h4>How quality is rolled</h4>
        <p>It is <b>not calculated</b> from IVs, potency, shininess or level. At capture the game
        rolls <b>one band</b> (using the table chances below) and then a random value between that
        band's min and max — three decimal places. That number is permanent; evolving changes
        nothing.</p>
        ${nota(`A pokémon with max IVs and potency V can still roll q<b>1.0</b> (Common) or
        q<b>1.7</b> (Legendary): three <b>independent</b> rolls on the same capture. High IV
        does <b>not</b> pull quality up.`)}
        ${tabelaDeQualidade(c)}
        ${nota(`The <b>1.6 – 1.7 range is an intentional gap</b>: no pokémon is born in it. The
        roll ceiling is exactly <b>1.8</b> (~0.29% chance). Shinies do not get extra quality — they
        are stronger from the <b>×${c.d.multShinyStats ?? 3} stat multiplier</b> and rerolled IVs, not from a higher q.`)}
        <p>The exponent varies per stat: <b>0.95</b> for HP and Speed, <b>0.8</b> for the other
        four. How <b>SPD IV</b> affects combat (cooldown, not running) is in
        <a data-cap="combate">Combat</a>.</p>

        <h4>Combat HP</h4>
        <pre class="wk-formula">combatHp = max(24, round(hp × 12))</pre>
        <p>A wild pokémon takes a further <b>×${c.d.multHpSelvagem ?? 5}</b> on top of that — see
        <a data-cap="combate">Combat</a>.</p>

        <h4>Refine — the “+1” bought with stones</h4>
        <p>The only way to touch a pokémon's <b>base</b> stats after it is born. Each step adds a
        permanent <b>+${c.d.refino?.passo ?? 1}</b> to one base stat, and it enters <b>before</b>
        everything else in the formula above — so it is multiplied by level, quality and potency.
        The step worth +1 on a plain level 100 is worth four times that on a shiny P5.</p>
        <p>You pay in the <b>evolution stone of the pokémon's own type</b> — the same one it
        evolves with, and the common one even if it is shiny. Final forms refine too: Dragonite
        evolves nowhere, but it uses Ancient Stone like any other DRAGON.</p>
<pre class="wk-formula">holding +N on a stat = ${N(c.d.refino?.custoBase ?? 500, c.lang)} × N³ stones, all told
cost of step N       = ${N(c.d.refino?.custoBase ?? 500, c.lang)} × (3N² − 3N + 1)</pre>
        ${tabelaDeRefino(c)}
        ${nota(`<b>There is no cap.</b> Whoever wants to keep climbing, climbs — the price sets the
        pace. The curve is cubic and not exponential for exactly that reason: by doubling, the
        twentieth step would cost 262 million stones and a de facto cap would be hidden in the
        formula.`)}
        ${nota(`The cost is <b>per stat</b>, not per pokémon. Four steps into HP means
        ${N(30500, c.lang)} for the fifth — but the first ATK step still costs
        ${N(c.d.refino?.custoBase ?? 500, c.lang)}. Refining is <b>choosing</b> what the creature is
        good at, not filling a bar.`)}
        <p><b>SPD does not refine</b>, and that is not an oversight: the SPD stat never enters
        combat — attack pace is decided by the Speed <b>IV</b> above. Selling "+1 SPD" would be
        selling a number that does nothing.</p>
        <p>The <b>score</b> and the <b>⚔</b> do not move with refining: both measure how the
        pokémon was <b>born</b>. What refining shows is the <b>+N</b> badge next to the name and
        the real stats climbing on the card.</p>
        <p>The “+” lives in two places: the header of the <b>On field</b> panel and each
        <b>Base stats</b> row on the card of a pokémon you own. Refining sends the pokémon to your
        <a data-cap="market">Collection</a>, out of NPC sales — return it to the Depot if you really
        want to sell it.</p>

        <h4>The starter floor</h4>
        <p>Your first pokémon does <b>not</b> go through the free roll. It is born with quality
        <b>≥ 1.30</b>, IV total <b>&gt; 140</b> and no single IV below <b>16</b>. Without that,
        one in ten trainers would start with a "Weak" band creature and the first hunt would be
        impossible.</p>`,
      es: `
        <p>Dos pokémon de la misma especie y nivel casi nunca son iguales. Lo que los separa son
        tres números sorteados <b>en la captura</b> y que <b>nunca cambian</b>: <b>calidad</b>,
        <b>IV</b> y <b>potencia</b>.</p>

        <pre class="wk-formula">stat = redond( (base + 2 × IV) × nivel/100 × calidad^exponente × multiplicador )
sumaStats = hp + atk + def + spAtk + spDef + speed</pre>

        <h4>IV — 1 a 32 por stat</h4>
        <p>Seis sorteos independientes, de <b>1 a 32</b> cada uno (máximo sumado: 192). Evolucionar
        <b>no</b> vuelve a sortear nada.</p>

        <h4>IV de SPD — cooldown, no velocidad de carrera</h4>
        <p>El <b>IV de Velocidad (SPD)</b> se sortea aparte, como los otros cinco. <b>No</b> entra
        en la fórmula de daño ni acelera la carrera en la cacería — el pokémon activo siempre va
        un poco delante del entrenador por diseño de la escena. Lo que acorta son los
        <b>cooldowns</b> de golpes: <b>−0,01 s por punto de IV</b> (IV 1 → −0,01 s; IV 32 →
        −0,32 s), fijo al nacer, en todo cooldown (global y de cada golpe). Sp.ATK y Sp.DEF solo
        cuentan en golpes <b>especiales</b>.</p>

        <h4>Calidad — el número que más pesa</h4>
        <p>Entra en <b>cada stat</b> como exponente (<code>calidad^exp</code>) — por eso cambia
        todo el pokémon y pesa más que el IV aislado. La línea <code>sumaStats</code> es solo la
        <b>suma de los seis stats</b> (útil en la Pokédex para comparar potencias). La <b>nota</b> y
        el <b>⚔</b> usan esa fuerza al nacer — ver <a data-cap="nota">Nota, Poder y Calculadora</a>.</p>
        <h4>Cómo nace la calidad</h4>
        <p><b>No se calcula</b> a partir de los IV, la potencia, el shiny ni el nivel. En la
        captura el juego sortea <b>una franja</b> (según las probabilidades de la tabla) y, dentro
        de ella, un valor aleatorio entre el mínimo y el máximo — con tres decimales. Ese número
        queda para siempre; evolucionar no lo cambia.</p>
        ${nota(`Un pokémon con IV al tope y potencia V puede nacer con q<b>1,0</b> (Común) o
        q<b>1,7</b> (Legendaria): son tres sorteos <b>independientes</b> en la misma captura. IV
        alto <b>no</b> sube la calidad.`)}
        ${tabelaDeQualidade(c)}
        ${nota(`La franja <b>1,6 – 1,7 es un hueco intencional</b>: ningún pokémon nace en ella. El
        tope del sorteo es exactamente <b>1,8</b> (~0,29% de probabilidad). El shiny no gana
        calidad extra — es más fuerte por el <b>×${c.d.multShinyStats ?? 3} en los stats</b> y los IV rerolados, no por un q
        mayor.`)}
        <p>El exponente cambia por stat: <b>0,95</b> para HP y Velocidad, <b>0,8</b> para los otros
        cuatro. El efecto del <b>IV de SPD</b> en combate (cooldown, no carrera) está en
        <a data-cap="combate">Combate</a>.</p>

        <h4>HP de combate</h4>
        <pre class="wk-formula">hpDeCombate = máx(24, redond(hp × 12))</pre>
        <p>Un salvaje todavía recibe <b>×${c.d.multHpSelvagem ?? 5}</b> encima de eso — ver
        <a data-cap="combate">Combate</a>.</p>

        <h4>Refinado — el “+1” comprado con piedras</h4>
        <p>Es la única forma de tocar la <b>base</b> de un pokémon después de nacer. Cada escalón
        suma <b>+${c.d.refino?.passo ?? 1}</b> permanente a un stat base, y entra <b>antes</b> que
        todo lo demás en la fórmula de arriba — o sea, se multiplica por nivel, calidad y
        potencia. El mismo escalón que vale +1 en un nivel 100 común vale cuatro veces eso en un
        P5 shiny.</p>
        <p>Se paga con la <b>piedra de evolución del tipo del propio pokémon</b> — la misma con la
        que evoluciona, y la común incluso si es shiny. Las formas finales también se refinan:
        Dragonite no evoluciona a ninguna parte, pero usa Ancient Stone como cualquier DRAGON.</p>
<pre class="wk-formula">tener +N en un stat = ${N(c.d.refino?.custoBase ?? 500, c.lang)} × N³ piedras, sumando todo
costo del escalón N = ${N(c.d.refino?.custoBase ?? 500, c.lang)} × (3N² − 3N + 1)</pre>
        ${tabelaDeRefino(c)}
        ${nota(`<b>No hay tope.</b> Quien quiera seguir subiendo, sube — el precio marca el ritmo.
        La curva es cúbica y no exponencial justo por eso: duplicando, el vigésimo escalón
        costaría 262 millones de piedras y habría un tope de hecho escondido en la fórmula.`)}
        ${nota(`El costo es <b>por stat</b>, no por pokémon. Quien puso cuatro escalones en HP paga
        ${N(30500, c.lang)} por el quinto — pero el primero de ATK sigue costando
        ${N(c.d.refino?.custoBase ?? 500, c.lang)}. Refinar es <b>elegir</b> en qué será bueno el
        bicho, no llenar una barra.`)}
        <p><b>El SPD no se refina</b>, y no es un olvido: el stat de SPD no entra en ningún
        combate — la cadencia de ataque la decide el <b>IV</b> de Speed, arriba. Vender “+1 SPD”
        sería vender un número que no hace nada.</p>
        <p>La <b>nota N=</b> y el <b>⚔</b> suben con el refinado — usan la base actual (especie + +N).
        TM elemental y held items no entran en la nota. El sello <b>+N</b> al lado del nombre muestra
        cuánto ya se invirtió; los stats reales suben en la ficha.</p>
        <p>El “+” está en dos lugares: en la cabecera del panel <b>En campo</b> y en cada línea de
        <b>Stats base</b> de la ficha de un pokémon tuyo. Refinar envía el pokémon a tu
        <a data-cap="market">Colección</a>, fuera de la venta al NPC — devuélvelo al Depósito si de
        verdad quieres venderlo.</p>

        <h4>El mínimo del inicial</h4>
        <p>El primer pokémon <b>no</b> pasa por el sorteo libre. Nace con calidad <b>≥ 1,30</b>,
        suma de IV <b>&gt; 140</b> y ningún IV por debajo de <b>16</b>. Sin eso, uno de cada diez
        entrenadores empezaría con un bicho de la franja "Débil" y la primera cacería sería
        imposible.</p>`,
    }),
  },

  // -------------------------------------------------------- 3b. nota e poder
  {
    id: 'nota',
    titulo: { pt: 'Nota, Poder e Calculadora', en: 'Score, Power and Calculator', es: 'Nota, Poder y Calculadora' },
    grupo: 'basico',
    html: (c) => ({
      pt: `
        <p>São <b>duas métricas diferentes</b> que o jogo mostra na ficha — e confundir as duas
        é a origem de quase todo mal-entendido sobre “pokémon bom”.</p>

        <h4>Nota N= (0–10) — alinhada ao ⚔@100</h4>
        <p>Mede o quão forte o pokémon <b>nasceu dentro da espécie</b>. Usa a <b>mesma força
        (score)</b> do ranking ⚔, como se todo mundo estivesse no <b>nível 100</b> — subir de
        nível não muda a nota, só o ⚔ que aparece no placar.</p>
        <pre class="wk-formula">score = força de nascimento (0–1), mesma base do ⚔
nota   = 10 × (score − pior possível) ÷ (melhor − pior)   ← só dentro da espécie</pre>
        <ul>
          <li><b>0</b> = pior nascimento possível <i>daquela</i> espécie; <b>10</b> = P5 + shiny + IV máximo.</li>
          <li><b>Evoluir não “derruba” a nota</b> se o bicho nasceu bem — IV, qualidade e potência ficam iguais.</li>
          <li>Refino (+N) <b>sobe</b> a nota e o ⚔ — usa a base atual (espécie + refino).</li>
        </ul>
        ${nota(`O <a data-cap="comunidade">Mercado da Comunidade</a> exige faixa mínima de nota na
        calculadora. <b>Shiny e P5 entram</b> mesmo abaixo da faixa.`)}

        <h4>A Calculadora na prática</h4>
        <p>Abra pelo botão <b>Calculadora</b> na ficha ou no menu. Quatro barras mostram quanto
        cada eixo (IV, qualidade, potência, shiny) pesa na <b>força total</b> — não são 25% fixos:
        P5 brilhante puxa mais que comum fraco. O número grande (0–10) vem da soma dos seis stats
        normalizada.</p>
        <p>A cor da caixa sobe um degrau a cada ponto de nota — são dez faixas. Uma nota bem no
        limite fica na faixa de baixo.</p>
        ${tabelaDeFaixasDaNota('pt')}
        <p>O bloco <b>Poder (ranking)</b> na calculadora estima o ⚔ no nível da ficha (ou nv 1
        se você abriu só a calculadora) — usa a mesma força da nota, multiplicada pelo nível.</p>
        <p>Em espécies que evoluem, aparece também <b>Potencial na evolução final</b>: projeta a
        nota N= nas formas finais alcançáveis (Eevee, ramificações…) com os mesmos IV, qualidade,
        potência e shiny — e avisa se cada final atinge a faixa do Mercado (nota mínima ou shiny/P5).</p>

        <h4>Poder (⚔) — ranking “Pokémon Forte”</h4>
        <p>É um <b>número único</b> no placar e na ficha. <b>Não é a nota</b> e <b>não muda
        combate</b> — só ordena quem aparece no ranking. Sobe com nível, refino e evolução.</p>
        <pre class="wk-formula">score = mesma força da nota (0–1)
poder = arred( nível × 10 × score )   → no nv 100: ⚔ ≈ 1000 × score</pre>
        <p>No <b>combate</b>, qualidade ainda entra como expoente em cada stat; potência e shiny
        ainda multiplicam os stats. O ⚔ do ranking é outra conta.</p>

        <h4>O que muda no combate</h4>
        <ul>
          <li><b>HP de combate</b> = máx(24, arred(hp × 12)). Selvagem leva ×5 por cima.</li>
          <li><b>Dano</b> usa ATK ou Sp.Atk vs DEF ou Sp.Def reais, tipo, STAB e efetividade —
          não usa o número “poder” diretamente.</li>
          <li><b>IV de SPD</b> encurta cooldowns (−0,01 s a −0,32 s), não a corrida na hunt.</li>
          <li><b>Defesa</b> reduz o dano recebido na fórmula clássica; mais DEF/Sp.Def = aguenta
          mais hits.</li>
        </ul>
        <p>Use o botão <b>Calculadora</b> na ficha ou no menu para simular IV, qualidade,
        potência e shiny.</p>`,
      en: `
        <p>These are <b>two different metrics</b> on the pokémon sheet — mixing them up is where
        most “good pokémon” confusion comes from.</p>

        <h4>Score N= (0–10) — aligned with ⚔@100</h4>
        <p>Measures how strong the pokémon was <b>born within its species</b>. Uses the <b>same
        strength (score)</b> as ranking ⚔, as if everyone were <b>level 100</b> — leveling up
        does not change the score; only the ⚔ on the ladder does.</p>
        <pre class="wk-formula">score = birth strength (0–1), same base as ⚔
N=     = 10 × (score − worst) ÷ (best − worst)   ← within species only</pre>
        <ul>
          <li><b>0</b> = worst possible birth <i>for that</i> species; <b>10</b> = P5 + shiny + max IV.</li>
          <li><b>Evolving does not “drop” the score</b> if the pokémon was born strong — IV, quality and potency stay.</li>
          <li>Refinement (+N) <b>raises</b> both score and ⚔ — uses current base (species + refine).</li>
        </ul>
        ${nota(`The <a data-cap="comunidade">Community Market</a> requires a minimum calculator score.
        <b>Shiny and P5 bypass</b> the bar.`)}

        <h4>Using the Calculator</h4>
        <p>Open it from the <b>Calculator</b> button on the sheet or menu. Four bars show how much
        each axis (IV, quality, potency, shiny) contributes to <b>total strength</b> — not fixed
        25%: a shiny P5 weighs more than a weak common. The big number (0–10) comes from the
        normalized sum of all six birth stats.</p>
        <p>The box color steps up with every point of score — ten tiers in all. A score right on a
        boundary stays in the lower tier.</p>
        ${tabelaDeFaixasDaNota('en')}
        <p>The <b>Power (ranking)</b> block estimates ⚔ at the sheet's level (or level 1 if you
        opened calculator alone) — same strength as N=, multiplied by level.</p>
        <p>For species that evolve, <b>Potential at final evolution</b> also appears: it projects
        the N= score onto every reachable final form (Eevee, branches…) with the same IV, quality,
        potency and shiny — and flags whether each final meets the Market bar (minimum score or shiny/P5).</p>

        <h4>Power (⚔) — “Strongest Pokémon” ladder</h4>
        <p>A <b>single ranking number</b> on the sheet and ladder. <b>Not the score</b> and
        <b>does not change combat</b> — only sort order. Rises with level, refinement and evolution.</p>
        <pre class="wk-formula">score = same strength as N= (0–1)
power = round( level × 10 × score )   → at lv 100: ⚔ ≈ 1000 × score</pre>
        <p>In <b>combat</b>, quality still uses per-stat exponents; potency and shiny still multiply
        stats. Ranking ⚔ is a separate formula.</p>

        <h4>What changes in combat</h4>
        <ul>
          <li><b>Combat HP</b> = max(24, round(hp × 12)). Wilds get ×5 on top.</li>
          <li><b>Damage</b> uses real ATK/Sp.Atk vs DEF/Sp.Def, type, STAB and effectiveness —
          not the “power” number directly.</li>
          <li><b>SPD IV</b> shortens cooldowns (−0.01 s to −0.32 s), not hunt running speed.</li>
          <li><b>Defense</b> lowers damage taken in the classic formula.</li>
        </ul>
        <p>Use <b>Calculator</b> on the sheet or menu to simulate IV, quality, potency and shiny.</p>`,
      es: `
        <p>Son <b>dos métricas distintas</b> en la ficha — confundirlas es el origen de casi todo
        malentendido sobre “pokémon bueno”.</p>

        <h4>Nota N= (0–10) — alineada al ⚔@100</h4>
        <p>Mide qué tan fuerte nació el pokémon <b>dentro de la especie</b>. Usa la <b>misma fuerza
        (score)</b> del ranking ⚔, como si todos estuvieran en <b>nivel 100</b> — subir de nivel
        no cambia la nota, solo el ⚔ del placar.</p>
        <pre class="wk-formula">score = fuerza al nacer (0–1), misma base del ⚔
nota  = 10 × (score − peor posible) ÷ (mejor − peor)   ← solo dentro de la especie</pre>
        <ul>
          <li><b>0</b> = peor nacimiento posible <i>de esa</i> especie; <b>10</b> = P5 + shiny + IV máximo.</li>
          <li><b>Evolucionar no “baja” la nota</b> si nació bien — IV, calidad y potencia se mantienen.</li>
          <li>El refinado (+N) <b>sube</b> la nota y el ⚔ — usa la base actual (especie + refino).</li>
        </ul>
        ${nota(`El <a data-cap="comunidade">Mercado de la Comunidad</a> exige nota mínima en la
        calculadora. <b>Shiny y P5 entran</b> aunque estén por debajo.`)}

        <h4>La Calculadora en la práctica</h4>
        <p>Ábrela con el botón <b>Calculadora</b> en la ficha o el menú. Cuatro barras muestran
        cuánto pesa cada eje (IV, calidad, potencia, shiny) en la <b>fuerza total</b> — no son
        25% fijos: un P5 shiny pesa más que un común débil. El número grande (0–10) sale de la
        suma de los seis stats normalizada.</p>
        <p>El color de la caja sube un escalón por cada punto de nota — son diez rangos. Una nota
        justo en el límite queda en el rango de abajo.</p>
        ${tabelaDeFaixasDaNota('es')}
        <p>El bloque <b>Poder (ranking)</b> estima el ⚔ al nivel de la ficha (o nv 1 si abriste
        solo la calculadora) — la misma fuerza que la nota, multiplicada por el nivel.</p>
        <p>En especies que evolucionan, también aparece <b>Potencial en la evolución final</b>:
        proyecta la nota N= en las formas finales alcanzables (Eevee, ramificaciones…) con los mismos
        IV, calidad, potencia y shiny — y avisa si cada final alcanza la barra del Mercado (nota mínima o shiny/P5).</p>

        <h4>Poder (⚔) — ranking “Pokémon Fuerte”</h4>
        <p>Es un <b>número único</b> en el placar y la ficha. <b>No es la nota</b> y <b>no cambia
        el combate</b> — solo ordena el ranking. Sube con nivel, refinado y evolución.</p>
        <pre class="wk-formula">score = misma fuerza que la nota (0–1)
poder = redond( nivel × 10 × score )   → en nv 100: ⚔ ≈ 1000 × score</pre>
        <p>En <b>combate</b> la calidad sigue como exponente por stat; potencia y shiny siguen
        multiplicando stats. El ⚔ del ranking es otra cuenta.</p>

        <h4>Qué cambia en combate</h4>
        <ul>
          <li><b>HP de combate</b> = máx(24, redond(hp × 12)).</li>
          <li><b>Daño</b> usa ATK/DEF reales — no el número “poder” directamente.</li>
          <li><b>IV de SPD</b> acorta cooldowns (−0,01 s a −0,32 s), no la carrera en la cacería.</li>
        </ul>
        <p>Usa la <b>Calculadora</b> en la ficha o el menú para simular IV, calidad, potencia
        y shiny.</p>`,
    }),
  },

  // ----------------------------------------------------------- 4. potência
  {
    id: 'potencia',
    titulo: { pt: 'Potência (I a V)', en: 'Potency (I to V)', es: 'Potencia (I a V)' },
    grupo: 'basico',
    html: (c) => ({
      pt: `
        <p>A <b>potência</b> é o segundo eixo que separa dois pokémon iguais — o primeiro é a
        qualidade. É um número de <b>1 a 5</b>, sorteado <b>uma vez, na captura</b>, e que
        <b>nunca muda</b>: subir de nível não melhora a potência.</p>
        ${tabelaDePotencia(c)}
        <p>O bônus multiplica <b>os seis stats</b> e entra no mesmo ponto da qualidade.</p>

        ${nota(`É por causa dela que um pokémon de <b>nível baixo</b> pode valer muito no
        <a data-cap="comunidade">Mercado da Comunidade</a>: nível qualquer um sobe, potência
        não. Um P4 nível 20 vale mais que um P1 nível 80 da mesma espécie.`)}

        <h4>Potência e shiny se multiplicam</h4>
        <p>Shiny é <b>×${c.d.multShinyStats}</b> em tudo. Um <b>P5 shiny</b> é
        <b>×${(1 + (c.d.potencias?.find((p) => p.n === 5)?.bonus ?? 1)) * (c.d.multShinyStats ?? 3)}</b> —
        três vezes um pokémon comum da mesma espécie e nível.</p>

        <p>Abra a ficha de qualquer espécie na <b>Pokédex</b> para ver o poder que cada potência
        daria naquele bicho.</p>`,
      en: `
        <p><b>Potency</b> is the second axis separating two otherwise identical pokémon — the
        first is quality. It is a number from <b>1 to 5</b>, rolled <b>once, at capture</b>, that
        <b>never changes</b>: levelling up does not improve potency.</p>
        ${tabelaDePotencia(c)}
        <p>The bonus multiplies <b>all six stats</b> and enters at the same point as quality.</p>

        ${nota(`This is why a <b>low-level</b> pokémon can be worth a lot on the
        <a data-cap="comunidade">Community Market</a>: anyone can grind levels, nobody can grind
        potency. A level 20 P4 is worth more than a level 80 P1 of the same species.`)}

        <h4>Potency and shiny multiply</h4>
        <p>Shiny is <b>×${c.d.multShinyStats}</b> on everything. A <b>shiny P5</b> is
        <b>×${(1 + (c.d.potencias?.find((p) => p.n === 5)?.bonus ?? 1)) * (c.d.multShinyStats ?? 3)}</b> —
        three times a common pokémon of the same species and level.</p>

        <p>Open any species sheet in the <b>Pokédex</b> to see the power each potency would give
        that creature.</p>`,
      es: `
        <p>La <b>potencia</b> es el segundo eje que separa a dos pokémon iguales — el primero es la
        calidad. Es un número de <b>1 a 5</b>, sorteado <b>una vez, en la captura</b>, y que
        <b>nunca cambia</b>: subir de nivel no mejora la potencia.</p>
        ${tabelaDePotencia(c)}
        <p>El bono multiplica <b>los seis stats</b> y entra en el mismo punto que la calidad.</p>

        ${nota(`Por eso un pokémon de <b>nivel bajo</b> puede valer mucho en el
        <a data-cap="comunidade">Mercado de la Comunidad</a>: el nivel lo sube cualquiera, la
        potencia no. Un P4 de nivel 20 vale más que un P1 de nivel 80 de la misma especie.`)}

        <h4>Potencia y shiny se multiplican</h4>
        <p>Shiny es <b>×${c.d.multShinyStats}</b> en todo. Un <b>P5 shiny</b> es
        <b>×${(1 + (c.d.potencias?.find((p) => p.n === 5)?.bonus ?? 1)) * (c.d.multShinyStats ?? 3)}</b> —
        tres veces un pokémon común de la misma especie y nivel.</p>

        <p>Abre la ficha de cualquier especie en la <b>Pokédex</b> para ver el poder que cada
        potencia daría en ese bicho.</p>`,
    }),
  },

  // -------------------------------------------------------------- 5. shiny
  {
    id: 'shiny',
    titulo: { pt: 'Shiny', en: 'Shiny', es: 'Shiny' },
    grupo: 'basico',
    html: (c) => ({
      pt: `
        <p><b>${Object.keys(c.d.shinyLooks ?? {}).length} espécies</b> têm forma shiny. Ela
        só se revela na <b>captura</b> — com arte própria (não é o mesmo desenho com outra cor)
        e um selo ✨ no cartão.</p>

        <h4>Quanto é raro</h4>
        <p>A chance é <b>a mesma para todas</b> — <b>1 em ${Math.round(1 / Number(c.d.chanceShiny)).toLocaleString('en-US').replace(/,/g, '.')}</b> por captura bem-sucedida
        — sorteada junto com qualidade, IV e potência. Na hunt, todo selvagem parece comum até
        a bola fechar.</p>
        ${tabelaDeShiny(c)}
        <p>O <b>Shiny Secret Lure</b>, da <a data-cap="loja">Loja</a>, <b>dobra</b> essa chance
        enquanto estiver ativo (1 em ${Math.round(1 / (Number(c.d.chanceShiny) * 2)).toLocaleString('en-US').replace(/,/g, '.')}).</p>

        <h4>O que o brilho dá</h4>
        <ul>
          <li><b>×${c.d.multShinyStats} em todos os stats.</b> É o maior multiplicador do jogo,
          e se multiplica com a potência.</li>
          <li><b>IV alto garantido</b>: o sorteio é refeito até a soma dos seis passar de
          <b>110</b> (o máximo é 192).</li>
          <li><b>Vale 10× a mais</b> na venda ao NPC (ver <a data-cap="market">Market</a>).</li>
          <li><b>Sobe a nota da calculadora</b> — o ×${c.d.multShinyStats ?? 3} nos stats entra na mesma conta de força de
          nascimento (ver <a data-cap="nota">Nota, Poder e Calculadora</a>).</li>
        </ul>

        ${nota(`<b>Capturar um shiny usa a mesma pokébola e a mesma chance por arremesso que
        qualquer outro.</b> O que é raro é o sorteio do brilho na hora em que a captura fecha —
        não dá para saber antes. Por isso vale gastar a melhor bola em todo corpo; a tabela de
        cada espécie está na ficha da Pokédex.`, 'aviso')}

        <h4>Evolução shiny</h4>
        <p>Um shiny <b>evolui</b>, mas não com a pedra comum: ele precisa de uma
        <b>Shiny Stone</b> do <b>tipo primário</b> da espécie. Um Shiny Abra pede a pedra
        <b>PSYCHIC</b> e vira um Shiny Kadabra; um Shiny Bulbasaur (GRASS/POISON) pede a de
        <b>GRASS</b>, porque o primário é o que conta.</p>

        <p>A pedra vem de <b>${N(custoFragPedra(c), c.lang)} Fragmentos de Shiny Stone</b>, na
        bancada <b>Fabricar Shiny Stone</b> do <b>Professor Carvalho</b>. O fragmento cai só na
        <b>Outland</b>, a ${pctFragPedra(c)} por derrota — cerca de <b>${mediaFragPedra(c)}</b>
        kills por fragmento.${dicaOutlandTiers(c)} Você escolhe o tipo na hora de fabricar, então os dez fragmentos
        nunca saem no tipo errado.</p>

        ${nota(`<b>Se a evolução ainda não tem forma shiny no jogo, a evolução é RECUSADA.</b>
        É proposital: sem a arte shiny da próxima etapa, evoluir trocaria o seu bicho raro por um
        de cor comum — e isso não teria como ser desfeito. A pedra pronta e o fragmento são
        negociáveis no <a data-cap="comunidade">Mercado da Comunidade</a>.`, 'atencao')}
`,
      en: `
        <p><b>${Object.keys(c.d.shinyLooks ?? {}).length} species</b> have a shiny form. It is
        only revealed on <b>capture</b> — with its own artwork (not a recolour) and a ✨ badge on
        the card.</p>

        <h4>How rare it is</h4>
        <p>The chance is <b>the same for every species</b> — <b>1 in ${Math.round(1 / Number(c.d.chanceShiny)).toLocaleString('en-US')}</b> per successful
        capture — rolled together with quality, IV and potency. In a hunt, every wild looks common
        until the ball closes.</p>
        ${tabelaDeShiny(c)}
        <p>The <b>Shiny Secret Lure</b>, from the <a data-cap="loja">Shop</a>, <b>doubles</b> that
        chance while active (1 in ${Math.round(1 / (Number(c.d.chanceShiny) * 2)).toLocaleString('en-US')}).</p>

        <h4>What the shine gives</h4>
        <ul>
          <li><b>×${c.d.multShinyStats} on every stat.</b> The biggest multiplier in the game, and
          it stacks multiplicatively with potency.</li>
          <li><b>Guaranteed high IV</b>: the roll is repeated until the six sum above <b>110</b>
          (the maximum is 192).</li>
          <li><b>Worth 10× more</b> when sold to the NPC (see <a data-cap="market">Market</a>).</li>
          <li><b>Raises the calculator score</b> — the ×${c.d.multShinyStats ?? 3} on stats enters the same birth-strength
          formula (see <a data-cap="nota">Score, Power and Calculator</a>).</li>
        </ul>

        ${nota(`<b>Catching a shiny uses the same ball and the same per-throw chance as any
        other.</b> What is rare is the shine roll when the capture closes — you cannot tell
        beforehand. So spend your best ball on every body; the per-species table is on the
        Pokédex sheet.`, 'aviso')}

        <h4>Shiny evolution</h4>
        <p>A shiny <b>can evolve</b>, but not with the ordinary stone: it needs a
        <b>Shiny Stone</b> of the species <b>primary type</b>. A Shiny Abra needs the
        <b>PSYCHIC</b> stone and becomes a Shiny Kadabra; a Shiny Bulbasaur (GRASS/POISON) needs
        the <b>GRASS</b> one, because the primary type is what counts.</p>

        <p>The stone comes from <b>${N(custoFragPedra(c), c.lang)} Shiny Stone Fragments</b>, at
        the <b>Craft Shiny Stone</b> bench at <b>Professor Oak</b>. The fragment only drops in
        <b>Outland</b>, at ${pctFragPedra(c)} per kill — around <b>${mediaFragPedra(c)}</b> kills
        per fragment.${dicaOutlandTiers(c)} You pick the type when crafting, so the ten fragments never come out as the
        wrong type.</p>

        ${nota(`<b>If the evolution has no shiny form in the game yet, the evolution is
        REFUSED.</b> That is deliberate: without the shiny art for the next stage, evolving would
        trade your rare pokémon for a normally coloured one — and that could not be undone. Both
        the finished stone and the fragment are tradeable on the
        <a data-cap="comunidade">Community Market</a>.`, 'atencao')}
`,
      es: `
        <p><b>${Object.keys(c.d.shinyLooks ?? {}).length} especies</b> tienen forma shiny. Solo se
        revela en la <b>captura</b> — con arte propio (no es el mismo dibujo con otro color) y un
        sello ✨ en la carta.</p>

        <h4>Qué tan raro es</h4>
        <p>La probabilidad es <b>la misma para todas</b> — <b>1 entre ${Math.round(1 / Number(c.d.chanceShiny)).toLocaleString('en-US').replace(/,/g, '.')}</b> por captura
        exitosa — sorteada junto con calidad, IV y potencia. En la cacería, todo salvaje parece
        común hasta que cierra la bola.</p>
        ${tabelaDeShiny(c)}
        <p>El <b>Shiny Secret Lure</b>, de la <a data-cap="loja">Tienda</a>, <b>duplica</b> esa
        probabilidad mientras esté activo (1 entre ${Math.round(1 / (Number(c.d.chanceShiny) * 2)).toLocaleString('en-US').replace(/,/g, '.')}).</p>

        <h4>Qué da el brillo</h4>
        <ul>
          <li><b>×${c.d.multShinyStats} en todos los stats.</b> Es el mayor multiplicador del juego
          y se multiplica con la potencia.</li>
          <li><b>IV alto garantizado</b>: el sorteo se repite hasta que la suma de los seis pase de
          <b>110</b> (el máximo es 192).</li>
          <li><b>Vale 10× más</b> al venderlo al NPC (ver <a data-cap="market">Market</a>).</li>
          <li><b>Sube la nota de la calculadora</b> — el ×${c.d.multShinyStats ?? 3} en stats entra en la misma cuenta de
          fuerza al nacer (ver <a data-cap="nota">Nota, Poder y Calculadora</a>).</li>
        </ul>

        ${nota(`<b>Capturar un shiny usa la misma poké ball y la misma probabilidad por lanzamiento
        que cualquier otro.</b> Lo raro es el sorteo del brillo cuando cierra la captura — no se
        puede saber antes. Por eso vale gastar la mejor bola en cada cuerpo; la tabla por especie
        está en la ficha de la Pokédex.`, 'aviso')}

        <h4>Evolución shiny</h4>
        <p>Un shiny <b>evoluciona</b>, pero no con la piedra común: necesita una
        <b>Shiny Stone</b> del <b>tipo primario</b> de la especie. Un Shiny Abra pide la piedra
        <b>PSYCHIC</b> y se convierte en Shiny Kadabra; un Shiny Bulbasaur (GRASS/POISON) pide la
        de <b>GRASS</b>, porque el primario es el que cuenta.</p>

        <p>La piedra sale de <b>${N(custoFragPedra(c), c.lang)} Fragmentos de Shiny Stone</b>, en
        el banco <b>Fabricar Shiny Stone</b> del <b>Profesor Oak</b>. El fragmento cae solo en
        <b>Outland</b>, al ${pctFragPedra(c)} por derrota — unos <b>${mediaFragPedra(c)}</b> kills
        por fragmento.${dicaOutlandTiers(c)} Eliges el tipo al fabricar, así que los diez fragmentos nunca salen del
        tipo equivocado.</p>

        ${nota(`<b>Si la evolución todavía no tiene forma shiny en el juego, la evolución se
        RECHAZA.</b> Es a propósito: sin el arte shiny de la siguiente etapa, evolucionar cambiaría
        tu pokémon raro por uno de color común — y eso no se podría deshacer. La piedra terminada
        y el fragmento son negociables en el <a data-cap="comunidade">Mercado de la
        Comunidad</a>.`, 'atencao')}
`,
    }),
  },

  // ----------------------------------------------------------- 5b. pokédex
  {
    id: 'pokedex',
    titulo: { pt: 'Pokédex', en: 'Pokédex', es: 'Pokédex' },
    grupo: 'basico',
    html: (c) => ({
      pt: `
        <p>A <b>Pokédex</b> registra o que você já viu e capturou. Abra pelo menu principal —
        é diferente do Mapa: aqui você consulta espécies, não escolhe onde caçar.</p>

        <h4>Nove gerações</h4>
        <p>As abas seguem a Pokédex nacional (1ª a 9ª). Cada aba mostra só espécies que
        <b>já têm sprite no jogo</b> — quem ainda não tem arte publicada não aparece na lista,
        para não prometer hunt que não existe.</p>
        <ul>
          <li><b>???</b> — ainda não encontrou na hunt.</li>
          <li><b>Nome visível, sem captura</b> — já derrotou ou viu, mas ainda não pegou.</li>
          <li><b>Cartão colorido</b> — já capturou pelo menos uma vez.</li>
        </ul>

        <h4>Busca</h4>
        <p>O campo de busca ignora a aba ativa: digite o nome ou número (#${725} funciona) e
        a grade mostra qualquer geração que bater.</p>

        <h4>Ficha da espécie</h4>
        <p>Clique num cartão para abrir a ficha completa:</p>
        <ul>
          <li>Stats base, tipos e sprite animado</li>
          <li><b>Golpes</b> — tabela na ficha (não nos cartões da grade)</li>
          <li>Loot, chance de captura por pokébola e chance de shiny (se a espécie tiver forma shiny —
          hoje são <b>${Object.keys(c.d.shinyLooks ?? {}).length}</b> no catálogo)</li>
          <li><b>Onde encontrar</b> — quando a hunt existir no Mapa</li>
        </ul>
        ${nota(`A contagem no topo (<i>vistos · capturados · total</i>) usa o mesmo catálogo
        visível da grade — só espécies com sprite.`, 'dica')}`,
      en: `
        <p>The <b>Pokédex</b> tracks what you have seen and caught. Open it from the main menu —
        unlike the Map, it is for browsing species, not picking a hunt.</p>

        <h4>Nine generations</h4>
        <p>Tabs follow the National Dex (Gen 1–9). Each tab lists only species that
        <b>already have an in-game sprite</b> — entries without published art stay hidden so the
        book does not promise hunts that do not exist yet.</p>
        <ul>
          <li><b>???</b> — not encountered in a hunt yet.</li>
          <li><b>Name visible, not caught</b> — seen or defeated, not captured.</li>
          <li><b>Coloured card</b> — caught at least once.</li>
        </ul>

        <h4>Search</h4>
        <p>The search box ignores the active tab: type a name or number (#725 works) and the
        grid shows matches from any generation.</p>

        <h4>Species sheet</h4>
        <p>Click a card for the full sheet:</p>
        <ul>
          <li>Base stats, types and animated sprite</li>
          <li><b>Moves</b> — table on the sheet (not on grid cards)</li>
          <li>Loot, catch rates per ball and shiny chance (when the species has a shiny form —
          <b>${Object.keys(c.d.shinyLooks ?? {}).length}</b> in the catalogue today)</li>
          <li><b>Where to find it</b> — when the hunt exists on the Map</li>
        </ul>
        ${nota(`The header count (<i>seen · caught · total</i>) uses the same visible catalogue
        as the grid — sprite-ready species only.`, 'dica')}`,
      es: `
        <p>La <b>Pokédex</b> registra lo que ya viste y capturaste. Ábrela desde el menú principal —
        no es el Mapa: aquí consultas especies, no eliges dónde cazar.</p>

        <h4>Nueve generaciones</h4>
        <p>Las pestañas siguen la Pokédex nacional (1.ª a 9.ª). Cada una muestra solo especies que
        <b>ya tienen sprite en el juego</b> — quien aún no tiene arte publicada no aparece, para
        no prometer una cacería que aún no existe.</p>
        <ul>
          <li><b>???</b> — aún no la encontraste en cacería.</li>
          <li><b>Nombre visible, sin captura</b> — ya la viste o derrotaste, pero no la atrapaste.</li>
          <li><b>Carta coloreada</b> — capturada al menos una vez.</li>
        </ul>

        <h4>Búsqueda</h4>
        <p>El buscador ignora la pestaña activa: escribe el nombre o número (#725 vale) y la
        cuadrícula muestra cualquier generación que coincida.</p>

        <h4>Ficha de la especie</h4>
        <p>Haz clic en una carta para la ficha completa:</p>
        <ul>
          <li>Stats base, tipos y sprite animado</li>
          <li><b>Movimientos</b> — tabla en la ficha (no en las cartas de la cuadrícula)</li>
          <li>Loot, probabilidad de captura por poké ball y chance shiny (si la especie tiene forma
          shiny — hoy <b>${Object.keys(c.d.shinyLooks ?? {}).length}</b> en el catálogo)</li>
          <li><b>Dónde encontrarla</b> — cuando la cacería exista en el Mapa</li>
        </ul>
        ${nota(`El contador superior (<i>vistos · capturados · total</i>) usa el mismo catálogo
        visible que la cuadrícula — solo especies con sprite.`, 'dica')}`,
    }),
  },

  // ------------------------------------------------------------ 6. combate
  // ---------------------------------------------------------- evolução e pedras
  {
    id: 'evolucao',
    titulo: { pt: 'Evolução e pedras', en: 'Evolution & stones', es: 'Evolución y piedras' },
    grupo: 'basico',
    html: (c) => ({
      pt: `
        <p>Evoluir pede <b>duas coisas ao mesmo tempo</b>: o pokémon no <b>nível</b> que a
        evolução exige, e <b>1 pedra</b> do tipo certo no inventário. Faltando qualquer uma, o
        botão recusa e não gasta nada.</p>

        <h4>O nível é onde a evolução APARECE no jogo</h4>
        <p>O nível que uma evolução pede é o <b>nível da hunt mais baixa em que o alvo
        aparece</b>. Se o Carracosta tem hunt de Nv 1.125, o Tirtouga vira Carracosta no
        <b>Nv 1.125</b> — nem mais, nem menos.</p>
        <p>A regra vale para as quatro regiões novas (Sinnoh, Unova, Kalos e Alola) e foi passada
        elo por elo: <b>149 evoluções</b> pediam um número que não correspondia a hunt nenhuma.
        O Tirtouga pedia 6.950 com o Carracosta à venda no 1.125; o Larvesta pedia 6.950 com o
        Volcarona no 1.125; o Skrelp pedia 20.000 com o Dragalge no 1.125.</p>
        ${nota(`Dezenove espécies têm hunt em <b>duas regiões</b> com preços bem diferentes — o
        Carracosta está em Sinnoh (1.125) e em Unova (6.950). Nesses casos vale <b>o menor</b>: o
        degrau em que ele passa a existir no jogo. A ficha da espécie mostra o mesmo número.`, 'dica')}
        ${nota(`<b>O Eevee é a exceção escolhida à mão:</b> ele evolui no <b>Nv ${N(NIVEL_EEVEE, c.lang)}</b>
        para <b>qualquer um</b> dos oito destinos — Vaporeon, Jolteon, Flareon, Espeon, Umbreon,
        Leafeon, Glaceon e Sylveon —, que é o nível em que Vaporeon, Jolteon e Flareon aparecem
        nas hunts de Kanto. Leafeon, Glaceon e Sylveon são de regiões mais altas, mas saem no
        mesmo degrau dos irmãos. A Pokédex mostra o mesmo número.`)}

        <h4>Os bebês evoluem de graça</h4>
        <p>Alguns pokémon são de uma geração <b>posterior</b> à da própria evolução: o Mime Jr. é
        de Sinnoh e o Mr. Mime é de Kanto. Aí a hunt do bebê (Nv 1.000) fica muito acima da hunt
        do alvo (Nv 80), e o nível deixa de ser trava — o Mime Jr. já nasce podendo evoluir.</p>
        <p>São 15 casos: Pichu, Cleffa, Igglybuff, Tyrogue, Smoochum, Elekid, Magby, Azurill,
        Wynaut, Budew, Chingling, Mime Jr., Munchlax, Mantyke — e os clones de Hoenn.</p>

        <h4>Variantes de Outland não evoluem</h4>
        <p>Os pokémon exclusivos da <b>Outland</b> — Ancient Pupitar, Ancient Dragonair, Furious
        Magikarp e todo o catálogo <b>#2001+</b> — <b>não evoluem</b>, mesmo quando o nome
        parece uma cadeia: um <b>Ancient Pupitar nunca vira Ancient Tyranitar</b> com pedra
        nenhuma. São espécies <b>separadas</b>; cada uma é capturada pronta na hunt. O servidor
        recusa com <i>“variantes de Outland não evoluem”</i>.</p>
        ${nota(`Isto é diferente das <b>espécies nacionais</b>: Pupitar ainda vira Tyranitar,
        Magikarp ainda vira Gyarados — só muda o nível pedido quando o destino mora em hunt alta.
        A trava vale só para a variante Outland.`, 'dica')}

        <h4>Qual pedra</h4>
        <p>A pedra é a do <b>tipo primário</b> do pokémon. Um Machop é FIGHTING e pede
        <b>Punch Stone</b>; um Abra é PSYCHIC e pede <b>Enigma Stone</b>.</p>
        <ul>
          <li><b>Cadeias que abrem em mais de um destino</b> pedem a pedra do que ele VAI VIRAR:
          o Eevee é NORMAL, mas para Vaporeon ele pede Water Stone e para Flareon, Fire Stone.</li>
          <li><b>Os pássaros NORMAL/FLYING</b> são a exceção escrita à mão: Pidgey, Spearow,
          Hoothoot, Taillow, Swablu, Starly, Rufflet, Fletchling e Pikipek pedem
          <b>Feather Stone</b>, não Sun Stone.</li>
          <li><b>Shiny</b> não usa a pedra comum: pede a <b>Shiny Stone</b> do mesmo tipo (ver o
          capítulo de Shiny).</li>
        </ul>
        ${tabelaDePedras(c)}

        <h4>De onde as pedras caem</h4>
        <p>A regra é a mesma que Kanto e Johto sempre seguiram, e agora vale nas quatro regiões
        novas: <b>o que um pokémon solta é do tipo dele</b>. A pedra de um tipo cai de bicho
        daquele tipo, e cada tipo tem um <b>item assinatura</b> que cai de praticamente todos os
        seus — Water Gem de todo WATER, Bug Gosme de todo BUG.</p>
        <p>Uns 20% do que cai escapa para tipos vizinhos, e isso é de propósito: um GRASS/POISON
        solta Venom Stone porque POISON também é dele.</p>
        ${nota(`Em Sinnoh, Unova, Kalos e Alola os drops estavam sorteados sem olhar o tipo — um
        Combee (BUG/FLYING) soltava Rock e Metal Stone e <b>não</b> soltava a Cocoon Stone de que
        ele precisa para virar Vespiquen. Foram <b>394 espécies</b> refeitas. Hoje
        <b>todo pokémon que evolui solta a própria pedra</b>, e cada região tem fonte para todas
        as pedras que ela pede — antes Alola não tinha nenhuma fonte de Fire Stone nem de
        Water Stone.`, 'aviso')}
        <p>Para <b>escolher</b> a pedra em vez de esperar o drop, leve pokémon do depot à
        <a data-cap="oferenda">Oferenda</a>: cada um pinta a fatia do tipo dele numa roleta.</p>`,
      en: `
        <p>Evolving needs <b>two things at once</b>: the pokémon at the <b>level</b> the evolution
        demands, and <b>1 stone</b> of the right type in your bag. Missing either, the button
        refuses and spends nothing.</p>

        <h4>The level is where the evolution APPEARS in the game</h4>
        <p>The level an evolution asks for is the <b>level of the lowest hunt where the target
        shows up</b>. If Carracosta's hunt is Lv 1,125, then Tirtouga becomes Carracosta at
        <b>Lv 1,125</b> — no more, no less.</p>
        <p>The rule covers the four new regions (Sinnoh, Unova, Kalos and Alola) and was applied
        link by link: <b>149 evolutions</b> asked for a number that matched no hunt at all.
        Tirtouga asked 6,950 with Carracosta on sale at 1,125; Larvesta asked 6,950 with Volcarona
        at 1,125; Skrelp asked 20,000 with Dragalge at 1,125.</p>
        ${nota(`Nineteen species have hunts in <b>two regions</b> at very different prices —
        Carracosta is in Sinnoh (1,125) and in Unova (6,950). In those cases the <b>lower</b> one
        wins: the step where it starts existing in the game. The species sheet shows the same
        number.`, 'dica')}
        ${nota(`<b>Eevee is the hand-picked exception:</b> it evolves at <b>Lv ${N(NIVEL_EEVEE, c.lang)}</b>
        into <b>any</b> of its eight targets — Vaporeon, Jolteon, Flareon, Espeon, Umbreon,
        Leafeon, Glaceon and Sylveon —, the level at which Vaporeon, Jolteon and Flareon show up in
        the Kanto hunts. Leafeon, Glaceon and Sylveon come from higher regions, but they unlock at
        the same step as their siblings. The Pokédex shows the same number.`)}

        <h4>Babies evolve for free</h4>
        <p>Some pokémon come from a generation <b>later</b> than their own evolution: Mime Jr. is
        from Sinnoh and Mr. Mime is from Kanto. So the baby's hunt (Lv 1,000) sits far above the
        target's hunt (Lv 80), and the level stops being a gate — Mime Jr. can evolve from the
        moment you catch it.</p>
        <p>There are 15 such cases: Pichu, Cleffa, Igglybuff, Tyrogue, Smoochum, Elekid, Magby,
        Azurill, Wynaut, Budew, Chingling, Mime Jr., Munchlax, Mantyke — plus the Hoenn clones.</p>

        <h4>Outland variants do not evolve</h4>
        <p>Pokémon exclusive to <b>Outland</b> — Ancient Pupitar, Ancient Dragonair, Furious
        Magikarp and the whole <b>#2001+</b> catalogue — <b>do not evolve</b>, even when the name
        looks like a chain: an <b>Ancient Pupitar never becomes Ancient Tyranitar</b> with any
        stone. They are <b>separate species</b>; each one is caught ready-made in the hunt. The
        server refuses with <i>“Outland variants do not evolve”</i>.</p>
        ${nota(`This is different from <b>national species</b>: Pupitar still becomes Tyranitar,
        Magikarp still becomes Gyarados — only the required level changes when the target lives in
        a high hunt. The lock applies to the Outland variant only.`, 'dica')}

        <h4>Which stone</h4>
        <p>The stone follows the pokémon's <b>primary type</b>. Machop is FIGHTING and asks for
        <b>Punch Stone</b>; Abra is PSYCHIC and asks for <b>Enigma Stone</b>.</p>
        <ul>
          <li><b>Chains that branch</b> ask for the stone of what it WILL BECOME: Eevee is NORMAL,
          but for Vaporeon it asks Water Stone and for Flareon, Fire Stone.</li>
          <li><b>The NORMAL/FLYING birds</b> are the hand-written exception: Pidgey, Spearow,
          Hoothoot, Taillow, Swablu, Starly, Rufflet, Fletchling and Pikipek ask for
          <b>Feather Stone</b>, not Sun Stone.</li>
          <li><b>Shiny</b> does not use the plain stone: it needs the <b>Shiny Stone</b> of the
          same type (see the Shiny chapter).</li>
        </ul>
        ${tabelaDePedras(c)}

        <h4>Where stones drop from</h4>
        <p>The rule is the one Kanto and Johto always followed, and it now holds in the four new
        regions: <b>what a pokémon drops is of its own type</b>. A type's stone drops from that
        type, and every type has a <b>signature item</b> that drops from nearly all of its
        members — Water Gem from every WATER, Bug Gosme from every BUG.</p>
        <p>About 20% of what drops leaks to neighbouring types, and that is deliberate: a
        GRASS/POISON drops Venom Stone because POISON is its type too.</p>
        ${nota(`In Sinnoh, Unova, Kalos and Alola the drops had been rolled without looking at the
        type — a Combee (BUG/FLYING) dropped Rock and Metal Stone and did <b>not</b> drop the
        Cocoon Stone it needs to become Vespiquen. <b>394 species</b> were redone. Today
        <b>every pokémon that evolves drops its own stone</b>, and every region has a source for
        every stone it asks for — Alola previously had no source of Fire Stone or Water Stone at
        all.`, 'aviso')}
        <p>To <b>choose</b> the stone instead of waiting for the drop, bring depot pokémon to the
        <a data-cap="oferenda">Offering</a>: each one paints its type's slice on a wheel.</p>`,
      es: `
        <p>Evolucionar exige <b>dos cosas a la vez</b>: el pokémon en el <b>nivel</b> que la
        evolución pide, y <b>1 piedra</b> del tipo correcto en el inventario. Si falta cualquiera,
        el botón se niega y no gasta nada.</p>

        <h4>El nivel es donde la evolución APARECE en el juego</h4>
        <p>El nivel que pide una evolución es el <b>nivel de la cacería más baja en la que
        aparece el objetivo</b>. Si Carracosta tiene cacería de Nv 1.125, Tirtouga se convierte en
        Carracosta en el <b>Nv 1.125</b> — ni más, ni menos.</p>
        <p>La regla vale para las cuatro regiones nuevas (Sinnoh, Unova, Kalos y Alola) y se pasó
        enlace por enlace: <b>149 evoluciones</b> pedían un número que no correspondía a ninguna
        cacería. Tirtouga pedía 6.950 con Carracosta a la venta en 1.125; Larvesta pedía 6.950 con
        Volcarona en 1.125; Skrelp pedía 20.000 con Dragalge en 1.125.</p>
        ${nota(`Diecinueve especies tienen cacería en <b>dos regiones</b> con precios muy
        distintos — Carracosta está en Sinnoh (1.125) y en Unova (6.950). En esos casos vale
        <b>el menor</b>: el escalón en que pasa a existir en el juego. La ficha de la especie
        muestra el mismo número.`, 'dica')}
        ${nota(`<b>Eevee es la excepción elegida a mano:</b> evoluciona en el <b>Nv ${N(NIVEL_EEVEE, c.lang)}</b>
        a <b>cualquiera</b> de sus ocho destinos — Vaporeon, Jolteon, Flareon, Espeon, Umbreon,
        Leafeon, Glaceon y Sylveon —, que es el nivel en que Vaporeon, Jolteon y Flareon aparecen
        en las cacerías de Kanto. Leafeon, Glaceon y Sylveon son de regiones más altas, pero salen
        en el mismo escalón que sus hermanos. La Pokédex muestra el mismo número.`)}

        <h4>Los bebés evolucionan gratis</h4>
        <p>Algunos pokémon son de una generación <b>posterior</b> a la de su propia evolución:
        Mime Jr. es de Sinnoh y Mr. Mime es de Kanto. Entonces la cacería del bebé (Nv 1.000)
        queda muy por encima de la del objetivo (Nv 80), y el nivel deja de ser una traba —
        Mime Jr. ya puede evolucionar desde que lo capturas.</p>
        <p>Son 15 casos: Pichu, Cleffa, Igglybuff, Tyrogue, Smoochum, Elekid, Magby, Azurill,
        Wynaut, Budew, Chingling, Mime Jr., Munchlax, Mantyke — y los clones de Hoenn.</p>

        <h4>Las variantes de Outland no evolucionan</h4>
        <p>Los pokémon exclusivos de <b>Outland</b> — Ancient Pupitar, Ancient Dragonair, Furious
        Magikarp y todo el catálogo <b>#2001+</b> — <b>no evolucionan</b>, aunque el nombre
        parezca una cadena: un <b>Ancient Pupitar nunca se convierte en Ancient Tyranitar</b> con
        ninguna piedra. Son especies <b>separadas</b>; cada una se captura hecha en la cacería. El
        servidor lo rechaza con <i>“variantes de Outland no evolucionan”</i>.</p>
        ${nota(`Esto es distinto de las <b>especies nacionales</b>: Pupitar sigue siendo Tyranitar,
        Magikarp sigue siendo Gyarados — solo cambia el nivel pedido cuando el destino vive en una
        cacería alta. La traba vale solo para la variante Outland.`, 'dica')}

        <h4>Qué piedra</h4>
        <p>La piedra es la del <b>tipo primario</b> del pokémon. Machop es FIGHTING y pide
        <b>Punch Stone</b>; Abra es PSYCHIC y pide <b>Enigma Stone</b>.</p>
        <ul>
          <li><b>Las cadenas que se abren</b> piden la piedra de en lo que SE VA A CONVERTIR:
          Eevee es NORMAL, pero para Vaporeon pide Water Stone y para Flareon, Fire Stone.</li>
          <li><b>Los pájaros NORMAL/FLYING</b> son la excepción escrita a mano: Pidgey, Spearow,
          Hoothoot, Taillow, Swablu, Starly, Rufflet, Fletchling y Pikipek piden
          <b>Feather Stone</b>, no Sun Stone.</li>
          <li><b>Shiny</b> no usa la piedra común: pide la <b>Shiny Stone</b> del mismo tipo (ver
          el capítulo de Shiny).</li>
        </ul>
        ${tabelaDePedras(c)}

        <h4>De dónde caen las piedras</h4>
        <p>La regla es la que Kanto y Johto siempre siguieron, y ahora vale en las cuatro regiones
        nuevas: <b>lo que suelta un pokémon es de su tipo</b>. La piedra de un tipo cae de bichos
        de ese tipo, y cada tipo tiene un <b>ítem insignia</b> que cae de casi todos los suyos —
        Water Gem de todo WATER, Bug Gosme de todo BUG.</p>
        <p>Un 20% de lo que cae se escapa a tipos vecinos, y es a propósito: un GRASS/POISON
        suelta Venom Stone porque POISON también es suyo.</p>
        ${nota(`En Sinnoh, Unova, Kalos y Alola los drops estaban sorteados sin mirar el tipo — un
        Combee (BUG/FLYING) soltaba Rock y Metal Stone y <b>no</b> soltaba la Cocoon Stone que
        necesita para ser Vespiquen. Se rehicieron <b>394 especies</b>. Hoy <b>todo pokémon que
        evoluciona suelta su propia piedra</b>, y cada región tiene fuente para todas las piedras
        que pide — antes Alola no tenía ninguna fuente de Fire Stone ni de Water Stone.`, 'aviso')}
        <p>Para <b>elegir</b> la piedra en vez de esperar el drop, lleva pokémon del depot a la
        <a data-cap="oferenda">Ofrenda</a>: cada uno pinta la porción de su tipo en una ruleta.</p>`,
    }),
  },

  // ------------------------------------------------------------- oferenda
  //
  // As casas saem de `OFERENDA_CASAS` e a nota do Auto Selecionar de `AUTO_LOCK_NOTA_MIN`, os
  // dois de `shared/`. A fatia de um pokémon é uma casa inteira (`100 / casas`), partida ao meio
  // quando ele pinta duas pedras — a conta de `shared/oferenda.mjs`.
  {
    id: 'oferenda',
    titulo: { pt: 'Oferenda de Pokémon', en: 'Pokémon Offering', es: 'Ofrenda de Pokémon' },
    grupo: 'basico',
    html: (c) => {
      const casas = N(OFERENDA_CASAS, c.lang);
      const pct = Math.round(100 / OFERENDA_CASAS);
      const meio = Math.round(50 / OFERENDA_CASAS);
      const dois = Math.round((2 / OFERENDA_CASAS) * 100);
      const vazio = 100 - dois;
      const autoLock = String(AUTO_LOCK_NOTA_MIN).replace('.', c.lang === 'en' ? '.' : ',');
      return {
        pt: `
        <p>A Oferenda troca pokémon do depot por <b>pedra de evolução</b>. Fica na bolsa:
        <b>Abrir Inventário → Oferenda</b>. Você carrega uma roleta com até <b>${casas}
        pokémon</b>, gira, e sai <b>uma pedra</b>, sorteada entre os tipos que você pôs. Os
        pokémon oferecidos <b>somem para sempre</b>.</p>

        <h4>Como funciona, em três passos</h4>
        <ol class="wk-passos">
          <li><b>Encha as casas.</b> Cada casa vazia é um <b>+</b> que abre a folha de escolha, a
          mesma do Mercado: cards com a fileira P·IV·Q·N, busca por nome, filtro de tipo, IV
          mínimo e ordenação. Ela não fecha a cada escolha, e o card escolhido mostra o número da
          casa. Clicar de novo tira.</li>
          <li><b>Confira a roleta.</b> Cada casa repete sprite, nome e selos do pokémon, e o
          círculo mostra as fatias e a chance de sair pedra antes de você girar.</li>
          <li><b>Clique em Oferendar e confirme.</b> O diálogo diz quantos pokémon vão e quantos
          deles são shiny. A roleta gira e para na fatia sorteada.</li>
        </ol>
        <p>Com pressa? O botão <b>⚡ Oferenda Rápida</b>, ao lado de Oferendar, pula a animação da
        roleta e mostra o resultado na hora — o mesmo sorteio, com a mesma confirmação.</p>

        <h4>Quanto cada pokémon vale</h4>
        <p><b>Um pokémon vale uma casa: ${pct}% do círculo</b>, tenha ele um tipo ou dois. A casa
        vai para a pedra do tipo dele (a mesma da <a data-cap="evolucao">tabela de pedras</a>).
        Quem tem dois tipos parte a casa ao meio: o segundo tipo compra <b>variedade</b>, não
        vantagem.</p>
        ${tabela(
          ['Na roleta', 'Pinta'],
          `<tr><td>Charmander (FIRE)</td><td class="wk-num">${pct}% de Fire Stone</td></tr>
           <tr><td>Charizard (FIRE/FLYING)</td><td class="wk-num">${meio}% de Fire Stone + ${meio}% de Feather Stone</td></tr>
           <tr><td>Gengar (GHOST/POISON)</td><td class="wk-num">${meio}% de Darkness Stone + ${meio}% de Venom Stone</td></tr>`,
        )}
        ${nota(`A divisão é pelas <b>pedras</b>, não pelos tipos. DARK e GHOST usam a mesma
        Darkness Stone, então um DARK/GHOST comum leva a casa <b>inteira</b> nela.`, 'dica')}

        <h4>A chance de sair pedra</h4>
        <p>É <b>pokémon ÷ ${casas}</b>. Com as ${casas} casas cheias, a pedra é garantida. Com
        menos, o resto do círculo vira a fatia <b>Nada</b>, desenhada antes de você girar: com
        dois pokémon, ${dois}% de chance de pedra e ${vazio}% de Nada.</p>

        <h4>Shiny paga em Shiny Stone</h4>
        <p>Um shiny na roleta não pinta a pedra comum: pinta a <b>Shiny Stone do tipo dele</b>. Um
        Shiny Dratini (DRAGON) só pode dar Dragon Shiny Stone; um Shiny Bulbasaur (GRASS/POISON)
        abre Grass <b>ou</b> Poison Shiny Stone. A fatia shiny tem contorno dourado.</p>
        <ul>
          <li><b>${casas} shinys do mesmo tipo</b> fecham a roleta e garantem a Shiny Stone.</li>
          <li>É a única fonte de Shiny Stone que não passa pelos fragmentos (ver
          <a data-cap="shiny">Shiny</a>).</li>
          <li>As Shiny Stones não se juntam como as comuns: um shiny DARK/GHOST pinta
          <b>duas</b> fatias, Dark e Ghost.</li>
        </ul>

        <h4>Quem não entra</h4>
        <p>A folha só lista o <b>depot</b>: quem está na equipe nem aparece. Também ficam de fora:</p>
        <ul>
          <li>quem segura <b>Exp. Share</b> ou está no <b>posto de XP Share</b> de uma
          <a data-cap="casa">Casa</a> — a folha diz quantos escondeu;</li>
          <li>quem está <b>anunciado</b> no <a data-cap="comunidade">Mercado da Comunidade</a>. Se
          ele já estava numa casa quando foi anunciado, a casa esvazia e o giro segue com os
          outros;</li>
          <li>o <b>último pokémon</b> da conta.</li>
        </ul>
        ${nota(`<b>A Coleção não barra a Oferenda.</b> Ela protege contra a venda ao NPC do
        <a data-cap="market">Market</a>, e aqui cada pokémon é uma escolha sua, olhando o card.
        O pokémon da Coleção aparece com a <b>★</b>, e o filtro <b>Local</b> separa Depot e
        Coleção.`, 'aviso')}

        <h4>Auto Selecionar</h4>
        <p>O botão ao lado de <b>Esvaziar</b> enche as casas vazias com os pokémon do depot de
        <b>menor nota</b> (a N= da <a data-cap="nota">calculadora</a>).</p>
        <ul>
          <li>Só pega nota <b>abaixo da do seu Auto Coleção N</b> (no Market; o padrão é
          ${autoLock}). Com três ruins e um ótimo no depot, a quarta casa fica vazia.</li>
          <li><b>Nunca pega:</b> shiny, P5, pokémon da Coleção, da vitrine do perfil, com
          item segurado, refino ou TM, o starter, nem as suas equipes do
          <a data-cap="pvp">PvP Ranqueado</a> e do <a data-cap="campeonato">Campeonato</a>.</li>
          <li>Empate na nota: primeiro o de nível menor, depois a captura mais recente.</li>
          <li>Na folha de escolha, o mesmo botão escolhe <b>só entre os que a lista mostra</b>:
          busque "charmander" (ou filtre FIRE) e clique para montar uma roleta só de Fire
          Stone.</li>
          <li>Ele só enche as casas. O giro continua pedindo a sua confirmação.</li>
        </ul>
        ${nota(`O sorteio é feito no <b>servidor</b>. A roleta que gira na tela só mostra o
        resultado que já saiu.`)}`,
        en: `
        <p>The Offering trades depot pokémon for an <b>evolution stone</b>. It lives in the bag:
        <b>Open Inventory → Offering</b>. You load a wheel with up to <b>${casas} pokémon</b>,
        spin, and get <b>one stone</b>, drawn among the types you put in. The offered pokémon are
        <b>gone for good</b>.</p>

        <h4>How it works, in three steps</h4>
        <ol class="wk-passos">
          <li><b>Fill the slots.</b> Each empty slot is a <b>+</b> that opens the picker, the same
          one the Market uses: cards with the P·IV·Q·N row, name search, type filter, minimum IV and
          sorting. It stays open while you pick, and a chosen card shows its slot number. Click it
          again to take it out.</li>
          <li><b>Check the wheel.</b> Each slot repeats the pokémon's sprite, name and badges, and
          the circle shows the slices and the chance of a stone before you spin.</li>
          <li><b>Click Offer and confirm.</b> The dialog says how many pokémon are going and how
          many of them are shiny. The wheel spins and stops on the drawn slice.</li>
        </ol>
        <p>In a hurry? The <b>⚡ Quick Offering</b> button, next to Offer, skips the wheel animation
        and shows the result right away — same draw, same confirmation.</p>

        <h4>What each pokémon is worth</h4>
        <p><b>One pokémon is worth one slot: ${pct}% of the circle</b>, whether it has one type or
        two. The slot goes to the stone of its type (the same as the
        <a data-cap="evolucao">stone table</a>). A dual-type splits the slot in half: the second
        type buys <b>variety</b>, not an edge.</p>
        ${tabela(
          ['On the wheel', 'Paints'],
          `<tr><td>Charmander (FIRE)</td><td class="wk-num">${pct}% Fire Stone</td></tr>
           <tr><td>Charizard (FIRE/FLYING)</td><td class="wk-num">${meio}% Fire Stone + ${meio}% Feather Stone</td></tr>
           <tr><td>Gengar (GHOST/POISON)</td><td class="wk-num">${meio}% Darkness Stone + ${meio}% Venom Stone</td></tr>`,
        )}
        ${nota(`The split follows the <b>stones</b>, not the types. DARK and GHOST share the same
        Darkness Stone, so a regular DARK/GHOST puts its <b>whole</b> slot on it.`, 'dica')}

        <h4>The chance of a stone</h4>
        <p>It is <b>pokémon ÷ ${casas}</b>. With all ${casas} slots filled, the stone is
        guaranteed. With fewer, the rest of the circle becomes the <b>Nothing</b> slice, drawn
        before you spin: with two pokémon, a ${dois}% chance of a stone and ${vazio}% Nothing.</p>

        <h4>Shiny pays in Shiny Stone</h4>
        <p>A shiny on the wheel does not paint the regular stone: it paints the <b>Shiny Stone of
        its type</b>. A Shiny Dratini (DRAGON) can only give a Dragon Shiny Stone; a Shiny
        Bulbasaur (GRASS/POISON) opens Grass <b>or</b> Poison Shiny Stone. The shiny slice has a
        gold outline.</p>
        <ul>
          <li><b>${casas} shinies of the same type</b> fill the wheel and guarantee the Shiny
          Stone.</li>
          <li>It is the only source of Shiny Stones that does not go through fragments (see
          <a data-cap="shiny">Shiny</a>).</li>
          <li>Shiny Stones do not merge like the regular ones: a DARK/GHOST shiny paints
          <b>two</b> slices, Dark and Ghost.</li>
        </ul>

        <h4>Who cannot go in</h4>
        <p>The picker only lists the <b>depot</b>: team members do not even show up. Also left
        out:</p>
        <ul>
          <li>anyone holding an <b>Exp. Share</b> or sitting in the <b>XP Share post</b> of a
          <a data-cap="casa">House</a> — the picker says how many it hid;</li>
          <li>anyone <b>listed</b> on the <a data-cap="comunidade">Community Market</a>. If it was
          already in a slot when it got listed, the slot empties and the spin goes on with the
          rest;</li>
          <li>the account's <b>last pokémon</b>.</li>
        </ul>
        ${nota(`<b>The Collection does not block the Offering.</b> It guards against NPC sales at
        the <a data-cap="market">Market</a>, and here every pokémon is your own choice, card in
        view. Collection pokémon show a <b>★</b>, and the <b>Location</b> filter splits Depot and
        Collection.`, 'aviso')}

        <h4>Auto Select</h4>
        <p>The button next to <b>Empty it</b> fills the empty slots with the <b>lowest-rated</b>
        depot pokémon (the N= from the <a data-cap="nota">calculator</a>).</p>
        <ul>
          <li>It only takes ratings <b>below your Auto Collection N</b> (in the Market; the default
          is ${autoLock}). With three bad ones and one great one in the depot, the fourth slot
          stays empty.</li>
          <li><b>It never takes:</b> shiny, P5, Collection, profile showcase, or pokémon with a
          held item, refine or TM, the starter, nor your <a data-cap="pvp">Ranked PvP</a> and
          <a data-cap="campeonato">Championship</a> teams.</li>
          <li>On a rating tie: lower level first, then the most recent catch.</li>
          <li>In the picker, the same button chooses <b>only among what the list shows</b>: search
          "charmander" (or filter FIRE) and click to build a Fire Stone-only wheel.</li>
          <li>It only fills the slots. The spin still asks for your confirmation.</li>
        </ul>
        ${nota(`The draw happens on the <b>server</b>. The wheel spinning on screen only shows the
        result that already came out.`)}`,
        es: `
        <p>La Ofrenda cambia pokémon del depot por una <b>piedra de evolución</b>. Está en la
        bolsa: <b>Abrir inventario → Ofrenda</b>. Cargas una ruleta con hasta <b>${casas}
        pokémon</b>, giras y sale <b>una piedra</b>, sorteada entre los tipos que pusiste. Los
        pokémon ofrecidos <b>desaparecen para siempre</b>.</p>

        <h4>Cómo funciona, en tres pasos</h4>
        <ol class="wk-passos">
          <li><b>Llena las casillas.</b> Cada casilla vacía es un <b>+</b> que abre la hoja de
          selección, la misma del Mercado: tarjetas con la fila P·IV·Q·N, búsqueda por nombre,
          filtro de tipo, IV mínimo y orden. No se cierra en cada elección, y la tarjeta elegida
          muestra el número de la casilla. Otro clic la quita.</li>
          <li><b>Revisa la ruleta.</b> Cada casilla repite el sprite, el nombre y los sellos del
          pokémon, y el círculo muestra las porciones y la probabilidad de piedra antes de
          girar.</li>
          <li><b>Pulsa Ofrendar y confirma.</b> El diálogo dice cuántos pokémon se van y cuántos
          son shiny. La ruleta gira y se detiene en la porción sorteada.</li>
        </ol>
        <p>¿Con prisa? El botón <b>⚡ Ofrenda Rápida</b>, al lado de Ofrendar, salta la animación
        de la ruleta y muestra el resultado al instante — el mismo sorteo, con la misma
        confirmación.</p>

        <h4>Cuánto vale cada pokémon</h4>
        <p><b>Un pokémon vale una casilla: el ${pct}% del círculo</b>, tenga uno o dos tipos. La
        casilla va a la piedra de su tipo (la misma de la
        <a data-cap="evolucao">tabla de piedras</a>). El de dos tipos parte la casilla por la
        mitad: el segundo tipo compra <b>variedad</b>, no ventaja.</p>
        ${tabela(
          ['En la ruleta', 'Pinta'],
          `<tr><td>Charmander (FIRE)</td><td class="wk-num">${pct}% de Fire Stone</td></tr>
           <tr><td>Charizard (FIRE/FLYING)</td><td class="wk-num">${meio}% de Fire Stone + ${meio}% de Feather Stone</td></tr>
           <tr><td>Gengar (GHOST/POISON)</td><td class="wk-num">${meio}% de Darkness Stone + ${meio}% de Venom Stone</td></tr>`,
        )}
        ${nota(`El reparto es por <b>piedras</b>, no por tipos. DARK y GHOST usan la misma Darkness
        Stone, así que un DARK/GHOST común pone la casilla <b>entera</b> en ella.`, 'dica')}

        <h4>La probabilidad de piedra</h4>
        <p>Es <b>pokémon ÷ ${casas}</b>. Con las ${casas} casillas llenas, la piedra está
        garantizada. Con menos, el resto del círculo es la porción <b>Nada</b>, dibujada antes de
        girar: con dos pokémon, ${dois}% de piedra y ${vazio}% de Nada.</p>

        <h4>El shiny paga en Shiny Stone</h4>
        <p>Un shiny en la ruleta no pinta la piedra común: pinta la <b>Shiny Stone de su tipo</b>.
        Un Shiny Dratini (DRAGON) solo puede dar Dragon Shiny Stone; un Shiny Bulbasaur
        (GRASS/POISON) abre Grass <b>o</b> Poison Shiny Stone. La porción shiny tiene borde
        dorado.</p>
        <ul>
          <li><b>${casas} shinys del mismo tipo</b> llenan la ruleta y garantizan la Shiny
          Stone.</li>
          <li>Es la única fuente de Shiny Stone que no pasa por los fragmentos (ver
          <a data-cap="shiny">Shiny</a>).</li>
          <li>Las Shiny Stones no se juntan como las comunes: un shiny DARK/GHOST pinta
          <b>dos</b> porciones, Dark y Ghost.</li>
        </ul>

        <h4>Quién no entra</h4>
        <p>La hoja solo lista el <b>depot</b>: los del equipo ni aparecen. También quedan
        fuera:</p>
        <ul>
          <li>quien lleva <b>Exp. Share</b> o está en el <b>puesto de XP Share</b> de una
          <a data-cap="casa">Casa</a> — la hoja dice cuántos ocultó;</li>
          <li>quien está <b>anunciado</b> en el <a data-cap="comunidade">Mercado de la
          Comunidad</a>. Si ya estaba en una casilla cuando se anunció, la casilla se vacía y el
          giro sigue con los demás;</li>
          <li>el <b>último pokémon</b> de la cuenta.</li>
        </ul>
        ${nota(`<b>La Colección no bloquea la Ofrenda.</b> Protege de la venta al NPC del
        <a data-cap="market">Market</a>, y aquí cada pokémon es una elección tuya, con la tarjeta
        a la vista. El pokémon de la Colección aparece con la <b>★</b>, y el filtro
        <b>Ubicación</b> separa Depósito y Colección.`, 'aviso')}

        <h4>Autoseleccionar</h4>
        <p>El botón junto a <b>Vaciar</b> llena las casillas vacías con los pokémon del depot de
        <b>menor nota</b> (la N= de la <a data-cap="nota">calculadora</a>).</p>
        <ul>
          <li>Solo elige notas <b>por debajo de tu Auto Colección N</b> (en el Market; por
          defecto ${autoLock}). Con tres malos y uno muy bueno en el depot, la cuarta casilla queda
          vacía.</li>
          <li><b>Nunca elige:</b> shiny, P5, los de la Colección, la vitrina del perfil, con
          objeto equipado, refinado o TM, el inicial, ni tus equipos del
          <a data-cap="pvp">PvP Clasificatorio</a> y del <a data-cap="campeonato">Campeonato</a>.</li>
          <li>Empate de nota: primero el de menor nivel, después la captura más reciente.</li>
          <li>En la hoja de selección, el mismo botón elige <b>solo entre los que muestra la
          lista</b>: busca "charmander" (o filtra FIRE) y pulsa para armar una ruleta solo de Fire
          Stone.</li>
          <li>Solo llena las casillas. El giro sigue pidiendo tu confirmación.</li>
        </ul>
        ${nota(`El sorteo se hace en el <b>servidor</b>. La ruleta que gira en pantalla solo
        muestra el resultado que ya salió.`)}`,
      };
    },
  },

  // -------------------------------------------------- configurações e modos
  //
  // Tudo aqui é preferência DESTE navegador (`preferencias.mjs`, em localStorage): nenhuma opção
  // muda o que o servidor caça, captura ou paga. Os nomes são os rótulos `cfg.*` do i18n.
  {
    id: 'configuracoes',
    titulo: { pt: 'Configurações e modos de tela', en: 'Settings and display modes', es: 'Ajustes y modos de pantalla' },
    grupo: 'basico',
    html: () => ({
      pt: `
        <p>A <b>engrenagem</b>, entre os botões do painel do treinador, abre as
        <b>Configurações</b>. Cada opção é um interruptor que vale <b>só neste navegador</b> (fica
        guardado no aparelho, não na conta), e nenhuma muda o que a caça rende: o servidor caça,
        captura e paga igual com qualquer combinação.</p>

        <h4>Para gastar menos</h4>
        <ul>
          <li><b>Modo Economia</b> — desliga a cena de vez: nada de mapa, de pokémon nem de
          animação. No lugar do palco fica um painel com o que se acompanha num idle — XP, Coins,
          abates e capturas por hora, o tempo de sessão e o histórico de capturas. A caça continua
          no servidor e você segue online. O botão da área abre o <a data-cap="mapa">Mapa</a> para
          trocar de hunt, e <b>Ligar a cena</b> volta ao normal. Feito para celular e PC fraco.</li>
          <li><b>Tela sempre acesa</b> (celular) — impede a tela de apagar sozinha com o jogo
          aberto: tela apagada suspende a página e tira você do mundo. Gasta a bateria da tela, então
          ligue junto com o Modo Economia e abaixe o brilho. Funciona no Chrome e no Samsung
          Internet do Android e no Safari do iPhone (iOS 16.4 ou mais novo); nos outros navegadores
          a opção aparece travada, dizendo o porquê.</li>
          <li><b>Modo otimizado</b> — mantém a cena, mas sem as animações de golpe e os números de
          dano. Ajuda em PC mais fraco.</li>
        </ul>

        <h4>Tela e interface</h4>
        <ul>
          <li><b>Modo Imersivo</b> — esconde painéis e HUD: só a batalha em tela cheia, como um
          wallpaper animado. Para sair, o botão no <b>canto superior direito</b>. Com o Modo
          Economia ligado junto, o que aparece é o painel da economia, com o mesmo botão de
          saída.</li>
          <li><b>Night Mode</b> — tema escuro no site inteiro.</li>
          <li><b>Painel de golpes</b> — mostra os golpes do pokémon ativo ao lado da batalha, com o
          cooldown de cada um. Só informação: não muda o combate automático.</li>
          <li><b>Layout de celular</b> — a cena em tela cheia, com painéis e chat numa gaveta no
          rodapé. A opção aparece em aparelho de toque (ou com o layout já ligado); desligue para
          ver o layout de computador.</li>
        </ul>

        <h4>Som</h4>
        <ul>
          <li><b>Sound Mode</b> — trilhas de cidade de Hoenn num player flutuante: tocar, pausar,
          próxima faixa e repetir.</li>
          <li><b>Som de shiny</b>, <b>Som de captura</b> e <b>Som de TM Disk Boss Drop</b> — tocam
          quando <b>você</b> captura um shiny, captura um pokémon ou tira uma peça de TM de um boss.
          Só no seu navegador: ninguém mais ouve.</li>
        </ul>

        <h4>Modo Pocket</h4>
        <p>Durante a hunt, o ícone ao lado da <b>Escape Rope</b> e do <b>Ir para o Centro
        Pokémon</b> abre a <b>janelinha Pocket</b>: a cena e os contadores da sessão (XP, ouro,
        abates e capturas por hora, shinies vistos e capturados). No Chrome e no Edge ela fica
        sempre em primeiro plano, para acompanhar a hunt com o jogo minimizado; nos outros
        navegadores vira um cartão que se arrasta pela tela. No Android, a cena pode seguir em
        picture-in-picture quando você aperta Home. Para trazer o jogo de volta, feche a
        janelinha ou clique de novo no ícone.</p>

        <h4>Novidades</h4>
        <p>O <b>!</b>, ao lado das bandeiras de idioma (no celular, na gaveta <b>Menu</b>), abre as
        <b>Novidades no PokéIdle</b>. Depois de uma atualização elas abrem sozinhas, uma vez, na
        próxima vez que você entrar; as setas levam às edições anteriores.</p>`,
      en: `
        <p>The <b>gear</b>, among the trainer panel's buttons, opens the <b>Settings</b>. Each
        option is a switch that applies <b>to this browser only</b> (it is stored on the device,
        not on the account), and none of them changes what hunting yields: the server hunts,
        catches and pays the same with any combination.</p>

        <h4>To spend less</h4>
        <ul>
          <li><b>Battery Saver</b> — turns the scene off entirely: no map, no pokémon, no
          animation. In place of the stage there is a panel with what you follow in an idle game —
          XP, Coins, kills and catches per hour, session time and the catch history. Hunting goes
          on in the server and you stay online. The area button opens the
          <a data-cap="mapa">Map</a> to switch hunts, and <b>Turn the scene on</b> goes back to
          normal. Made for phones and weak PCs.</li>
          <li><b>Keep screen on</b> (phone) — stops the screen from turning off by itself with the
          game open: a dark screen suspends the page and takes you out of the world. It spends
          screen battery, so turn it on together with Battery Saver and lower the brightness. Works
          in Chrome and Samsung Internet on Android and in Safari on iPhone (iOS 16.4 or newer); in
          other browsers the option shows locked, saying why.</li>
          <li><b>Optimized mode</b> — keeps the scene, but without move animations and damage
          numbers. Helps on weaker PCs.</li>
        </ul>

        <h4>Screen and interface</h4>
        <ul>
          <li><b>Immersive mode</b> — hides panels and HUD: just the battle in full screen, like an
          animated wallpaper. To leave, use the button in the <b>top-right corner</b>. With Battery
          Saver on as well, what shows is the Battery Saver panel, with the same exit button.</li>
          <li><b>Night mode</b> — dark theme across the whole site.</li>
          <li><b>Moves panel</b> — shows the active pokémon's moves next to the battle, with each
          one's cooldown. Information only: it does not change the automatic combat.</li>
          <li><b>Mobile layout</b> — the scene in full screen, with panels and chat in a drawer at
          the bottom. The option shows on touch devices (or with the layout already on); turn it
          off to see the desktop layout.</li>
        </ul>

        <h4>Sound</h4>
        <ul>
          <li><b>Sound mode</b> — Hoenn town themes in a floating player: play, pause, next track
          and repeat.</li>
          <li><b>Shiny sound</b>, <b>Catch sound</b> and <b>TM Disk Boss Drop sound</b> — they play
          when <b>you</b> catch a shiny, catch a pokémon or get a TM piece from a boss. Only in your
          browser: nobody else hears them.</li>
        </ul>

        <h4>Pocket Mode</h4>
        <p>During a hunt, the icon next to the <b>Escape Rope</b> and <b>Go to the Pokémon
        Center</b> opens the <b>Pocket window</b>: the scene and the session counters (XP, gold,
        kills and catches per hour, shinies seen and caught). In Chrome and Edge it stays always
        on top, so you can follow the hunt with the game minimized; in other browsers it becomes a
        card you drag around the screen. On Android, the scene can carry on in
        picture-in-picture when you press Home. To bring the game back, close the window or click
        the icon again.</p>

        <h4>What's new</h4>
        <p>The <b>!</b>, next to the language flags (on a phone, in the <b>Menu</b> drawer), opens
        <b>What's new in PokéIdle</b>. After an update it opens by itself, once, the next time you
        log in; the arrows go back to earlier editions.</p>`,
      es: `
        <p>El <b>engranaje</b>, entre los botones del panel del entrenador, abre los
        <b>Ajustes</b>. Cada opción es un interruptor que vale <b>solo en este navegador</b> (se
        guarda en el dispositivo, no en la cuenta), y ninguna cambia lo que rinde la cacería: el
        servidor caza, captura y paga igual con cualquier combinación.</p>

        <h4>Para gastar menos</h4>
        <ul>
          <li><b>Modo Ahorro</b> — apaga la escena del todo: sin mapa, sin pokémon y sin
          animación. En lugar del escenario queda un panel con lo que se sigue en un idle — XP,
          Coins, derrotas y capturas por hora, el tiempo de sesión y el historial de capturas. La
          cacería sigue en el servidor y tú sigues en línea. El botón de la zona abre el
          <a data-cap="mapa">Mapa</a> para cambiar de cacería, y <b>Encender la escena</b> vuelve a
          lo normal. Pensado para móvil y PC flojo.</li>
          <li><b>Pantalla siempre encendida</b> (móvil) — evita que la pantalla se apague sola con
          el juego abierto: con la pantalla apagada la página se suspende y sales del mundo. Gasta
          la batería de la pantalla, así que enciéndela junto con el Modo Ahorro y baja el brillo.
          Funciona en Chrome y Samsung Internet en Android y en Safari en iPhone (iOS 16.4 o más
          nuevo); en los demás navegadores la opción aparece bloqueada, diciendo por qué.</li>
          <li><b>Modo optimizado</b> — mantiene la escena, pero sin las animaciones de golpe ni los
          números de daño. Ayuda en PC más flojo.</li>
        </ul>

        <h4>Pantalla e interfaz</h4>
        <ul>
          <li><b>Modo inmersivo</b> — oculta paneles y HUD: solo la batalla a pantalla completa,
          como un fondo animado. Para salir, el botón de la <b>esquina superior derecha</b>. Con el
          Modo Ahorro encendido a la vez, lo que aparece es el panel del ahorro, con el mismo botón
          de salida.</li>
          <li><b>Modo nocturno</b> — tema oscuro en todo el sitio.</li>
          <li><b>Panel de golpes</b> — muestra los golpes del pokémon activo junto a la batalla, con
          el cooldown de cada uno. Solo información: no cambia el combate automático.</li>
          <li><b>Diseño de móvil</b> — la escena a pantalla completa, con paneles y chat en un
          cajón abajo. La opción aparece en dispositivos táctiles (o con el diseño ya encendido);
          apágala para ver el diseño de ordenador.</li>
        </ul>

        <h4>Sonido</h4>
        <ul>
          <li><b>Modo sonido</b> — músicas de ciudad de Hoenn en un reproductor flotante:
          reproducir, pausar, siguiente pista y repetir.</li>
          <li><b>Sonido de shiny</b>, <b>Sonido de captura</b> y <b>Sonido de TM Disk Boss Drop</b>
          — suenan cuando <b>tú</b> capturas un shiny, capturas un pokémon o sacas una pieza de TM
          de un boss. Solo en tu navegador: nadie más los oye.</li>
        </ul>

        <h4>Modo Pocket</h4>
        <p>Durante la cacería, el icono junto a la <b>Escape Rope</b> y a <b>Ir al Centro
        Pokémon</b> abre la <b>ventanita Pocket</b>: la escena y los contadores de la sesión (XP,
        oro, derrotas y capturas por hora, shinies vistos y capturados). En Chrome y Edge queda
        siempre en primer plano, para seguir la cacería con el juego minimizado; en los demás
        navegadores se vuelve una tarjeta que se arrastra por la pantalla. En Android, la escena
        puede seguir en picture-in-picture al pulsar Inicio. Para traer el juego de vuelta, cierra
        la ventanita o pulsa de nuevo el icono.</p>

        <h4>Novedades</h4>
        <p>El <b>!</b>, junto a las banderas de idioma (en el móvil, en el cajón <b>Menú</b>), abre
        las <b>Novedades en PokéIdle</b>. Tras una actualización se abren solas, una vez, la
        próxima vez que entres; las flechas llevan a las ediciones anteriores.</p>`,
    }),
  },

  {
    id: 'combate',
    titulo: { pt: 'Combate', en: 'Combat', es: 'Combate' },
    grupo: 'luta',
    html: (c) => ({
      pt: `
        <p>O pokémon ativo anda até o selvagem <b>mais próximo</b> e só troca golpes quando
        <b>encosta</b> nele. Nada de dano voando de um lado a outro do mapa.</p>

        <h4>O dano</h4>
        <pre class="wk-formula">base  = ((2 × nível/5 + 2) × power × atk/def) / 50 + 2
final = base × STAB × efetividade × aleatório(0,85–1,00)</pre>
        <ul>
          <li><b>power</b> é o do golpe usado. Cada golpe tem o próprio <b>cooldown</b> (de 2 a
          60 segundos) e um <b>nível mínimo</b> para ser aprendido.</li>
          <li><b>STAB</b> é <b>×1,5</b> quando o golpe é de um dos tipos do próprio pokémon.</li>
          <li><b>atk/def</b> usa Ataque e Defesa em golpe físico, e Sp.Atk / Sp.Def em especial.</li>
          <li><b>efetividade</b> vem da <a data-cap="tipos">tabela de tipos</a>, já amplificada.</li>
        </ul>

        <h4>O ataque básico</h4>
        <p>Enquanto todos os golpes estão carregando, o pokémon dá uma <b>Investida</b>:
        power <b>30</b>, a cada <b>2 s</b>, no tipo dele. Sem ela um Caterpie daria dois golpes e
        ficaria dez segundos parado. Se o alvo for imune aos dois tipos dele, só um golpe de
        verdade resolve.</p>

        <h4>IV de SPD — cooldown</h4>
        <p>O stat <b>SPD</b> na ficha <b>não</b> entra na fórmula de dano. O <b>IV de SPD</b>
        (1–32, sorteado na captura) encurta cooldowns: <b>10 ms por ponto</b> (até −320 ms),
        com piso de 400 ms. Vale no intervalo global entre golpes, no cooldown de cada golpe e
        na <a data-cap="pvp">PvP Ranqueado</a> — mesma regra. <b>Não</b> acelera a corrida na hunt.</p>
        ${tabela(
          [c.r.regra, c.r.valor],
          `<tr><td>Intervalo global base (seus golpes)</td><td class="wk-num">0,9 s</td></tr>
           <tr><td>Com IV SPD 32 (piso)</td><td class="wk-num destaque">0,4 s</td></tr>
           <tr><td>Cooldown de cada golpe</td><td class="wk-num">também encurta (−0,01 s / IV)</td></tr>`,
        )}

        <h4>Movimento na hunt</h4>
        <p>O pokémon ativo corre um pouco <b>na frente</b> do treinador — é ritmo da cena (260 ms
        vs 290 ms por tile), não stat SPD. Com IV alto você <b>ataca</b> mais rápido e passa mais
        tempo correndo entre alvos, o que pode parecer que “disparou”, mas a velocidade de passo
        não mudou.</p>

        <h4>O selvagem joga com vantagem</h4>
        ${tabela(
          [c.r.regra, c.r.valor],
          `<tr><td>HP do selvagem na hunt</td><td class="wk-num destaque">×${c.d.multHpSelvagem ?? 5}</td></tr>
           <tr><td>Dano do selvagem por golpe</td><td class="wk-num destaque">×${c.d.multDanoSelvagem ?? 1.8}</td></tr>
           <tr><td>Intervalo mínimo entre golpes seus</td><td class="wk-num">0,9 s</td></tr>
           <tr><td>Intervalo mínimo entre golpes dele</td><td class="wk-num">1,4 s</td></tr>`,
        )}
        <p>Não é injustiça: é o que faz uma hunt no seu nível ser uma luta, e não uma fila.</p>

        <h4>Ondas e corpos</h4>
        <p>Os selvagens nascem em <b>ondas</b>, nos pontos de spawn da área. Quando o campo
        esvazia, a onda seguinte entra em poucos segundos. Quem cai <b>fica no chão por
        30 segundos</b> — e é nele que se joga a bola.</p>

        <h4>Drop na Outland</h4>
        <p>Além do loot da espécie (tabela na <b>Pokédex</b>), selvagens derrotados na
        <b>Outland</b> podem soltar <b>1× Bronze Boss Token</b> — entrada de
        <a data-cap="bosses">boss</a>. Kanto e Orre não dropam.</p>
        ${tabela(
          [c.r.item, c.r.chance, c.r.quando],
          `<tr><td>Bronze Boss Token</td><td class="wk-num destaque">${pctBossToken(c)} · ${umEm(chanceBossToken(c))}</td><td>kill na Outland</td></tr>`,
        )}
        ${nota(`Média de ~${mediaBossToken(c)} derrotas por token na Outland 1 — as outras Outlands
        multiplicam essa chance (tabela logo abaixo). O Loot Boost da Loja,
        o bônus de ranking da guild e os eventos de farm aumentam a chance. O NPC não compra — preço só no
        <a data-cap="comunidade">Mercado da Comunidade</a>.`, 'dica')}

        <h4>As ${quantasOutlands(c)} Outlands</h4>
        <p>A aba <b>Outland</b> do Mapa tem um seletor com as
        <b>${quantasOutlands(c)} Outlands</b>. É o <b>mesmo mapa</b>, os <b>mesmos pokémon</b> e
        o mesmo nível 150 em todas — o que muda é a chance dos três drops raros da área (Bronze
        Boss Token, Fragmento de Chave e Fragmento de Shiny Stone):</p>
        ${tabelaOutlandTiers(c)}
        ${nota(`O degrau vale para os <b>três raros ao mesmo tempo</b> e multiplica <b>depois</b>
        do Loot Boost. XP, ouro, captura e o loot normal da espécie não mudam — quem sobe de
        Outland está comprando raridade, não velocidade.`, 'dica')}

        <h4>Evolução</h4>
        <p>Variantes de Outland <b>não evoluem</b> — um Ancient Pupitar não vira Ancient Tyranitar.
        Ver <a data-cap="evolucao">Evolução e pedras</a>.</p>`,
      en: `
        <p>The active pokémon walks to the <b>nearest</b> wild and only trades blows once it
        <b>reaches</b> it. No damage flying across the map.</p>

        <h4>Damage</h4>
        <pre class="wk-formula">base  = ((2 × level/5 + 2) × power × atk/def) / 50 + 2
final = base × STAB × effectiveness × random(0.85–1.00)</pre>
        <ul>
          <li><b>power</b> is the move's. Every move has its own <b>cooldown</b> (2 to 60 seconds)
          and a <b>minimum level</b> to be learned.</li>
          <li><b>STAB</b> is <b>×1.5</b> when the move matches one of the pokémon's own types.</li>
          <li><b>atk/def</b> uses Attack and Defence for physical moves, Sp.Atk / Sp.Def for
          special ones.</li>
          <li><b>effectiveness</b> comes from the <a data-cap="tipos">type chart</a>, already
          amplified.</li>
        </ul>

        <h4>The basic attack</h4>
        <p>While every move is on cooldown, the pokémon throws a <b>Tackle</b>: power <b>30</b>,
        every <b>2 s</b>, in its own type. Without it a Caterpie would land two moves and then
        stand still for ten seconds. If the target is immune to both of its types, only a real
        move works.</p>

        <h4>SPD IV — cooldown</h4>
        <p>The <b>SPD</b> stat on the sheet does <b>not</b> enter the damage formula. <b>SPD IV</b>
        (1–32, rolled at capture) shortens cooldowns: <b>10 ms per point</b> (up to −320 ms),
        with a 400 ms floor. Applies to the global gap between attacks, each move's cooldown and
        the <a data-cap="pvp">Ranked PvP</a> — same rule. It does <b>not</b> speed up running on
        the hunt map.</p>
        ${tabela(
          [c.r.regra, c.r.valor],
          `<tr><td>Base global gap (your attacks)</td><td class="wk-num">0.9 s</td></tr>
           <tr><td>With SPD IV 32 (floor)</td><td class="wk-num destaque">0.4 s</td></tr>
           <tr><td>Each move's cooldown</td><td class="wk-num">also shortens (−0.01 s / IV)</td></tr>`,
        )}

        <h4>Movement on the hunt</h4>
        <p>The active pokémon runs slightly <b>ahead</b> of the trainer — scene pacing (260 ms vs
        290 ms per tile), not SPD stat. High SPD IV makes you <b>attack</b> faster and spend more
        time running between targets, which can look like it “shot ahead”, but step speed did not
        change.</p>

        <h4>The wild plays with an edge</h4>
        ${tabela(
          [c.r.regra, c.r.valor],
          `<tr><td>Wild HP on the hunt</td><td class="wk-num destaque">×${c.d.multHpSelvagem ?? 5}</td></tr>
           <tr><td>Wild damage per hit</td><td class="wk-num destaque">×${c.d.multDanoSelvagem ?? 1.8}</td></tr>
           <tr><td>Minimum gap between your hits</td><td class="wk-num">0.9 s</td></tr>
           <tr><td>Minimum gap between its hits</td><td class="wk-num">1.4 s</td></tr>`,
        )}
        <p>It is not unfair: it is what makes a hunt at your level a fight rather than a queue.</p>

        <h4>Waves and bodies</h4>
        <p>Wilds spawn in <b>waves</b>, at the area's spawn points. When the field empties, the
        next wave arrives within seconds. Whatever falls <b>stays on the ground for 30
        seconds</b> — and that is what you throw a ball at.</p>

        <h4>Outland drop</h4>
        <p>Besides species loot (table in the <b>Pokédex</b>), wilds defeated in
        <b>Outland</b> can drop <b>1× Bronze Boss Token</b> — a <a data-cap="bosses">boss</a>
        entry ticket. Kanto and Orre do not.</p>
        ${tabela(
          [c.r.item, c.r.chance, c.r.quando],
          `<tr><td>Bronze Boss Token</td><td class="wk-num destaque">${pctBossToken(c)} · ${umEm(chanceBossToken(c))}</td><td>Outland kill</td></tr>`,
        )}
        ${nota(`Average ~${mediaBossToken(c)} defeats per token in Outland 1 — the other Outlands
        multiply that chance (table right below). The Shop's Loot Boost, the
        guild ranking bonus and farm events raise the chance. The NPC does not buy it — price only on the
        <a data-cap="comunidade">Community Market</a>.`, 'dica')}

        <h4>The ${quantasOutlands(c)} Outlands</h4>
        <p>The <b>Outland</b> tab on the Map has a selector with all
        <b>${quantasOutlands(c)} Outlands</b>. Same map, same pokémon and the same level 150 in
        every one of them — what changes is the chance of the area's three rare drops (Bronze
        Boss Token, Key Fragment and Shiny Stone Fragment):</p>
        ${tabelaOutlandTiers(c)}
        ${nota(`The step applies to <b>all three rares at once</b> and multiplies <b>after</b>
        Loot Boost. XP, gold, capture and the species' normal loot do not change — moving up an
        Outland buys rarity, not speed.`, 'dica')}

        <h4>Evolution</h4>
        <p>Outland variants <b>do not evolve</b> — an Ancient Pupitar does not become Ancient
        Tyranitar. See <a data-cap="evolucao">Evolution &amp; stones</a>.</p>`,
      es: `
        <p>El pokémon activo camina hasta el salvaje <b>más cercano</b> y solo intercambia golpes
        cuando lo <b>alcanza</b>. Nada de daño volando de un lado a otro del mapa.</p>

        <h4>El daño</h4>
        <pre class="wk-formula">base  = ((2 × nivel/5 + 2) × power × atk/def) / 50 + 2
final = base × STAB × efectividad × aleatorio(0,85–1,00)</pre>
        <ul>
          <li><b>power</b> es el del movimiento. Cada uno tiene su propio <b>cooldown</b> (de 2 a
          60 segundos) y un <b>nivel mínimo</b> para aprenderse.</li>
          <li><b>STAB</b> es <b>×1,5</b> cuando el movimiento es de uno de los tipos del pokémon.</li>
          <li><b>atk/def</b> usa Ataque y Defensa en movimientos físicos, y Sp.Atk / Sp.Def en
          especiales.</li>
          <li><b>efectividad</b> viene de la <a data-cap="tipos">tabla de tipos</a>, ya
          amplificada.</li>
        </ul>

        <h4>El ataque básico</h4>
        <p>Mientras todos los movimientos se recargan, el pokémon lanza una <b>Embestida</b>:
        power <b>30</b>, cada <b>2 s</b>, de su propio tipo. Sin ella un Caterpie daría dos golpes
        y se quedaría diez segundos quieto. Si el objetivo es inmune a sus dos tipos, solo un
        movimiento de verdad sirve.</p>

        <h4>IV de SPD — cooldown</h4>
        <p>El stat <b>SPD</b> en la ficha <b>no</b> entra en la fórmula de daño. El <b>IV de SPD</b>
        (1–32, sorteado al capturar) acorta cooldowns: <b>10 ms por punto</b> (hasta −320 ms),
        con piso de 400 ms. Vale en el intervalo global, en el cooldown de cada golpe y en el
        <a data-cap="pvp">PvP Clasificatorio</a> — misma regla. <b>No</b> acelera la carrera en la cacería.</p>
        ${tabela(
          [c.r.regra, c.r.valor],
          `<tr><td>Intervalo global base (tus golpes)</td><td class="wk-num">0,9 s</td></tr>
           <tr><td>Con IV SPD 32 (piso)</td><td class="wk-num destaque">0,4 s</td></tr>
           <tr><td>Cooldown de cada golpe</td><td class="wk-num">también acorta (−0,01 s / IV)</td></tr>`,
        )}

        <h4>Movimiento en la cacería</h4>
        <p>El pokémon activo corre un poco <b>delante</b> del entrenador — ritmo de la escena (260 ms
        vs 290 ms por tile), no stat SPD. Con IV alto <b>atacas</b> más rápido y pasas más tiempo
        corriendo entre objetivos; puede parecer que “disparó”, pero la velocidad de paso no cambió.</p>

        <h4>El salvaje juega con ventaja</h4>
        ${tabela(
          [c.r.regra, c.r.valor],
          `<tr><td>HP del salvaje en la cacería</td><td class="wk-num destaque">×${c.d.multHpSelvagem ?? 5}</td></tr>
           <tr><td>Daño del salvaje por golpe</td><td class="wk-num destaque">×${c.d.multDanoSelvagem ?? 1.8}</td></tr>
           <tr><td>Intervalo mínimo entre tus golpes</td><td class="wk-num">0,9 s</td></tr>
           <tr><td>Intervalo mínimo entre los suyos</td><td class="wk-num">1,4 s</td></tr>`,
        )}
        <p>No es injusticia: es lo que hace que una cacería de tu nivel sea un combate y no una
        fila.</p>

        <h4>Oleadas y cuerpos</h4>
        <p>Los salvajes nacen en <b>oleadas</b>, en los puntos de aparición de la zona. Cuando el
        campo se vacía, la siguiente entra en pocos segundos. El que cae <b>se queda en el suelo
        30 segundos</b> — y es ahí donde se lanza la bola.</p>

        <h4>Drop en Outland</h4>
        <p>Además del loot de la especie (tabla en la <b>Pokédex</b>), los salvajes derrotados en
        <b>Outland</b> pueden soltar <b>1× Bronze Boss Token</b> — entrada de
        <a data-cap="bosses">boss</a>. Kanto y Orre no.</p>
        ${tabela(
          [c.r.item, c.r.chance, c.r.quando],
          `<tr><td>Bronze Boss Token</td><td class="wk-num destaque">${pctBossToken(c)} · ${umEm(chanceBossToken(c))}</td><td>kill en Outland</td></tr>`,
        )}
        ${nota(`Media de ~${mediaBossToken(c)} derrotas por token en Outland 1 — las demás Outlands
        multiplican esa probabilidad (tabla justo abajo). El Loot Boost de la
        Tienda, el bono de ranking de la guild y los eventos de farm suben la chance. El NPC no compra — precio solo en el
        <a data-cap="comunidade">Mercado de la Comunidad</a>.`, 'dica')}

        <h4>Las ${quantasOutlands(c)} Outlands</h4>
        <p>La pestaña <b>Outland</b> del Mapa tiene un selector con las
        <b>${quantasOutlands(c)} Outlands</b>. Es el <b>mismo mapa</b>, los <b>mismos pokémon</b>
        y el mismo nivel 150 en todas — lo que cambia es la probabilidad de los tres drops raros
        de la zona (Bronze Boss Token, Fragmento de Llave y Fragmento de Shiny Stone):</p>
        ${tabelaOutlandTiers(c)}
        ${nota(`El escalón vale para los <b>tres raros a la vez</b> y multiplica <b>después</b>
        del Loot Boost. XP, oro, captura y el loot normal de la especie no cambian — subir de
        Outland compra rareza, no velocidad.`, 'dica')}

        <h4>Evolución</h4>
        <p>Las variantes de Outland <b>no evolucionan</b> — un Ancient Pupitar no se convierte en
        Ancient Tyranitar. Ver <a data-cap="evolucao">Evolución y piedras</a>.</p>`,
    }),
  },

  // -------------------------------------------------------------- 7. tipos
  {
    id: 'tipos',
    titulo: { pt: 'Tipos: forças e fraquezas', en: 'Types: strengths and weaknesses', es: 'Tipos: fuerzas y debilidades' },
    grupo: 'luta',
    html: (c) => ({
      pt: `
        <p>A efetividade é <b>multiplicativa nos dois tipos</b> do defensor. Água contra
        Rocha/Terra é ×2 × ×2 = <b>×4</b>.</p>
        <pre class="wk-formula">efetividade = tabela[atacante][tipo1] × tabela[atacante][tipo2]</pre>

        <h4>Na hunt a vantagem é ${c.d.ampliacaoHunt ?? 1.5}× mais forte</h4>
        <p>É a mecânica mais específica deste jogo, e vale <b>nos dois sentidos</b>: bater no
        tipo certo compensa muito mais, e bater no errado dói muito mais.</p>
        ${tabelaDeAmplificacao(c)}
        ${nota(`Imunidade (×0) e neutro (×1) <b>não</b> mudam. Fogo contra Água vira <b>×0,33</b> —
        é literalmente por isso que um Charmander não encara um Magikarp: com HP ×5 ele
        simplesmente não morre.`)}

        <h4>A tabela completa</h4>
        <p>Linha = tipo do <b>golpe</b>. Coluna = tipo do <b>defensor</b>. Célula vazia é neutro
        (×1). Passe o mouse para ver o valor já amplificado da hunt.</p>
        ${gradeDeTipos(c)}`,
      en: `
        <p>Effectiveness is <b>multiplicative across both</b> defender types. Water against
        Rock/Ground is ×2 × ×2 = <b>×4</b>.</p>
        <pre class="wk-formula">effectiveness = chart[attacker][type1] × chart[attacker][type2]</pre>

        <h4>On the hunt the advantage is ${c.d.ampliacaoHunt ?? 1.5}× stronger</h4>
        <p>This is the most game-specific mechanic here, and it cuts <b>both ways</b>: hitting the
        right type pays much more, and hitting the wrong one hurts much more.</p>
        ${tabelaDeAmplificacao(c)}
        ${nota(`Immunity (×0) and neutral (×1) do <b>not</b> change. Fire against Water becomes
        <b>×0.33</b> — which is literally why a Charmander cannot handle a Magikarp: with ×5 HP it
        simply will not die.`)}

        <h4>The full chart</h4>
        <p>Row = <b>move</b> type. Column = <b>defender</b> type. An empty cell is neutral (×1).
        Hover to see the hunt-amplified value.</p>
        ${gradeDeTipos(c)}`,
      es: `
        <p>La efectividad es <b>multiplicativa en los dos tipos</b> del defensor. Agua contra
        Roca/Tierra es ×2 × ×2 = <b>×4</b>.</p>
        <pre class="wk-formula">efectividad = tabla[atacante][tipo1] × tabla[atacante][tipo2]</pre>

        <h4>En la cacería la ventaja es ${c.d.ampliacaoHunt ?? 1.5}× más fuerte</h4>
        <p>Es la mecánica más específica de este juego, y vale <b>en los dos sentidos</b>: pegar
        con el tipo correcto compensa mucho más, y pegar con el equivocado duele mucho más.</p>
        ${tabelaDeAmplificacao(c)}
        ${nota(`La inmunidad (×0) y lo neutro (×1) <b>no</b> cambian. Fuego contra Agua pasa a
        <b>×0,33</b> — literalmente por eso un Charmander no aguanta a un Magikarp: con HP ×5
        simplemente no muere.`)}

        <h4>La tabla completa</h4>
        <p>Fila = tipo del <b>movimiento</b>. Columna = tipo del <b>defensor</b>. Celda vacía es
        neutro (×1). Pasa el ratón para ver el valor ya amplificado de la cacería.</p>
        ${gradeDeTipos(c)}`,
    }),
  },

  // ------------------------------------------------------------ 8. captura
  {
    id: 'captura',
    titulo: { pt: 'Captura', en: 'Catching', es: 'Captura' },
    grupo: 'luta',
    html: (c) => {
      const beast = (c.d.catalogoBolas ?? []).find((b) => b.id === 5);
      const catchBeast = beast?.catchRate ?? 8;
      const pctFacil = P(chanceCapturaWiki(c, PRECO_CAPTURA_FACIL, catchBeast), c.lang);
      const pctMediano = P(chanceCapturaWiki(c, PRECO_CAPTURA_MEDIANO, catchBeast), c.lang);
      return {
      pt: `
        <h4>As pokébolas</h4>
        ${tabelaDeBolas(c)}
        <p>A <b>Beast Ball</b> é a mais forte e não se compra com ouro — só em pacotes na
        <a data-cap="loja">Loja de Diamantes</a>.</p>

        <h4>A chance por arremesso</h4>
        <pre class="wk-formula">raridade = log10(máx(100, preçoNpc)) − 1
fator    = 1 + raridade³ / ${c.d.captura?.raridadeDiv ?? 17}
chance   = ${c.d.captura?.base ?? 0.0075} × (eficiência / fator) × (1,4 − hpAtual/hpMáximo)</pre>
        <p>Limitada entre <b>${P(c.d.captura?.piso ?? 0.003, c.lang)}</b> e
        <b>${P(c.d.captura?.teto ?? 0.1, c.lang)}</b>. Três coisas decidem tudo:</p>
        <ul>
          <li><b>Quanto o pokémon vale</b> (o preço de NPC dele, em escala logarítmica). Um
          Pidgey sai fácil; um Dragonite, não.</li>
          <li><b>A bola.</b> A eficiência entra multiplicando direto.</li>
          <li><b>O HP do alvo.</b> A bola só vai em quem já caiu, e corpo tem HP zero — que é a
          ponta boa da fórmula.</li>
        </ul>

        ${nota(`<b>Capturar é difícil de propósito.</b> Com a MELHOR bola, num corpo caído, a
        espécie mais fácil do jogo dá <b>${pctFacil}</b> e a mediana dá <b>${pctMediano}</b> — e daí para cima
        cai rápido. A ficha de cada espécie na Pokédex mostra a tabela exata, bola por bola,
        com quantas derrotas isso significa na média.`, 'dica')}

        <h4>É uma tentativa por corpo</h4>
        <p>Se a bola falhar num <b>corpo caído</b>, ele some do mapa. Não dá para despejar bolas
        no mesmo alvo até sair — o custo por captura existe justamente por isso. Um selvagem
        <b>vivo</b> continua em campo quando a bola falha, porque ele ainda está lutando.</p>

        <h4>O nível do capturado</h4>
        <p>O selvagem <b>luta</b> no nível da hunt; o capturado <b>nasce</b> no teto da espécie.
        O teto sai da cadeia evolutiva dela:</p>
        <pre class="wk-formula">cadeia de 3 (Treecko → Grovyle → Sceptile)   20 · 40 · 100
cadeia de 2 (Makuhita → Hariyama)                 40 · 100
não evolui (Spinda, variantes de Outland)              100</pre>
        <p><b>Até o Nv 100 nada muda</b> — Kanto e Johto inteiras entregam o bicho no
        nível em que ele estava caído. Acima disso o teto manda: um Torterra derrubado numa hunt
        de 3.500 entra na equipe no <b>Nv 100</b>, e um Turtwig, no <b>Nv 20</b>.</p>
        <p>A <b>evolução das espécies nacionais</b> segue a mesma escada: quando o destino mora em
        hunt de Nv 100+, o elo pede o <b>teto do destino</b> (40 ou 100), não o nível da hunt
        onde ele aparece. O caminho é capturar no 20, treinar até 40, evoluir; treinar até 100,
        evoluir de novo. <b>Variantes de Outland (#2001+) não entram nessa conta — não
        evoluem</b> (ver capítulo Evolução).</p>

        ${nota(`Cada ficha da Pokédex tem a linha <b>Nível ao capturar</b>, e o painel dos caídos
        mostra o "→ Nv" antes de você gastar a bola. O bicho continua valendo o que vale — ele
        só chega para ser treinado, e não pronto.`, 'dica')}

        <h4>O que aumenta</h4>
        <ul>
          <li><b>Capture Boost</b> (Loja) — <b>dobra</b> a chance por arremesso, respeitando o
          teto de ${P(c.d.captura?.teto ?? 0.1, c.lang)}.</li>
          <li><b>Bola melhor</b> — a Poké Ball é a mais barata <i>por arremesso</i>, mas a Ultra
          e a Beast gastam menos tempo.</li>
        </ul>

        <h4>Automação</h4>
        <p>A opção <b>Lançar pokébola</b> arremessa sozinha nos corpos caídos, respeitando um
        intervalo de 1,2 s. Ela é um <b>benefício de VIP</b> — ver
        <a data-cap="automacoes">Automações</a>.</p>`,
      en: `
        <h4>The balls</h4>
        ${tabelaDeBolas(c)}
        <p>The <b>Beast Ball</b> is the strongest and cannot be bought with gold — only in packs
        at the <a data-cap="loja">Diamond Shop</a>.</p>

        <h4>Chance per throw</h4>
        <pre class="wk-formula">rarity = log10(max(100, npcPrice)) − 1
factor = 1 + rarity³ / ${c.d.captura?.raridadeDiv ?? 17}
chance = ${c.d.captura?.base ?? 0.0075} × (efficiency / factor) × (1.4 − currentHp/maxHp)</pre>
        <p>Clamped between <b>${P(c.d.captura?.piso ?? 0.003, c.lang)}</b> and
        <b>${P(c.d.captura?.teto ?? 0.1, c.lang)}</b>. Three things decide everything:</p>
        <ul>
          <li><b>How much the pokémon is worth</b> (its NPC price, on a log scale). A Pidgey comes
          easy; a Dragonite does not.</li>
          <li><b>The ball.</b> Efficiency multiplies directly.</li>
          <li><b>The target's HP.</b> The ball only goes at something already down, and a body has
          zero HP — the good end of the formula.</li>
        </ul>

        ${nota(`<b>Catching is meant to be hard.</b> With the BEST ball, on a fallen body, the
        easiest species in the game gives <b>${pctFacil}</b> and the median gives <b>${pctMediano}</b> — and it
        drops fast from there. Each species sheet in the Pokédex shows the exact table, ball by
        ball, with how many kills that means on average.`, 'dica')}

        <h4>One attempt per body</h4>
        <p>If the ball fails on a <b>fallen body</b>, it vanishes from the map. You cannot dump
        balls on the same target until one sticks — that is precisely what gives capture a cost. A
        <b>living</b> wild stays on the field when a ball fails, because it is still fighting.</p>

        <h4>The level it joins at</h4>
        <p>The wild one <b>fights</b> at the hunt's level; the caught one <b>is born</b> at the
        species cap. The cap comes from its evolution chain:</p>
        <pre class="wk-formula">3-stage chain (Treecko → Grovyle → Sceptile)   20 · 40 · 100
2-stage chain (Makuhita → Hariyama)                 40 · 100
no evolution (Spinda, Outland variants)                  100</pre>
        <p><b>Up to Lv 100 nothing changes</b> — all of Kanto and Johto hand you the
        pokémon at the level it was lying at. Above that the cap rules: a Torterra knocked down in
        a level 3,500 hunt joins at <b>Lv 100</b>, and a Turtwig at <b>Lv 20</b>.</p>
        <p><b>National species</b> follow the same ladder: when the target lives in a hunt above
        Lv 100, the step asks for the <b>destination's cap</b> (40 or 100), not the level of the
        hunt where it appears. Catch at 20, train to 40, evolve; train to 100, evolve again.
        <b>Outland variants (#2001+) are not part of this — they do not evolve</b> (see the
        Evolution chapter).</p>

        ${nota(`Every Pokédex sheet has a <b>Level when caught</b> line, and the fallen panel shows
        the "→ Lv" before you spend the ball. The pokémon is still worth what it is worth — it just
        arrives to be trained, not finished.`, 'dica')}

        <h4>What raises it</h4>
        <ul>
          <li><b>Capture Boost</b> (Shop) — <b>doubles</b> the per-throw chance, still respecting
          the ${P(c.d.captura?.teto ?? 0.1, c.lang)} ceiling.</li>
          <li><b>A better ball</b> — the Poké Ball is the cheapest <i>per throw</i>, but the Ultra
          and the Beast spend less of your time.</li>
        </ul>

        <h4>Automation</h4>
        <p>The <b>Throw poké ball</b> option throws at fallen bodies on its own, respecting a 1.2 s
        gap. It is a <b>VIP benefit</b> — see <a data-cap="automacoes">Automation</a>.</p>`,
      es: `
        <h4>Las poké balls</h4>
        ${tabelaDeBolas(c)}
        <p>La <b>Beast Ball</b> es la más fuerte y no se compra con oro — solo en paquetes en la
        <a data-cap="loja">Tienda de Diamantes</a>.</p>

        <h4>La probabilidad por lanzamiento</h4>
        <pre class="wk-formula">rareza = log10(máx(100, precioNpc)) − 1
factor = 1 + rareza³ / ${c.d.captura?.raridadeDiv ?? 17}
prob.  = ${c.d.captura?.base ?? 0.0075} × (eficiencia / factor) × (1,4 − hpActual/hpMáximo)</pre>
        <p>Limitada entre <b>${P(c.d.captura?.piso ?? 0.003, c.lang)}</b> y
        <b>${P(c.d.captura?.teto ?? 0.1, c.lang)}</b>. Tres cosas lo deciden todo:</p>
        <ul>
          <li><b>Cuánto vale el pokémon</b> (su precio de NPC, en escala logarítmica). Un Pidgey
          sale fácil; un Dragonite, no.</li>
          <li><b>La bola.</b> La eficiencia multiplica directamente.</li>
          <li><b>El HP del objetivo.</b> La bola solo va a quien ya cayó, y un cuerpo tiene HP cero —
          el extremo bueno de la fórmula.</li>
        </ul>

        ${nota(`<b>Capturar es difícil a propósito.</b> Con la MEJOR bola, en un cuerpo caído, la
        especie más fácil del juego da <b>${pctFacil}</b> y la mediana da <b>${pctMediano}</b> — y de ahí para
        arriba cae rápido. La ficha de cada especie en la Pokédex muestra la tabla exacta, bola
        por bola, con cuántas derrotas significa eso de media.`, 'dica')}

        <h4>Es un intento por cuerpo</h4>
        <p>Si la bola falla en un <b>cuerpo caído</b>, este desaparece del mapa. No se pueden
        volcar bolas sobre el mismo objetivo hasta que salga — el coste por captura existe
        justamente por eso. Un salvaje <b>vivo</b> sigue en el campo cuando la bola falla, porque
        todavía está peleando.</p>

        <h4>El nivel del capturado</h4>
        <p>El salvaje <b>pelea</b> en el nivel de la cacería; el capturado <b>nace</b> en el tope
        de la especie. El tope sale de su cadena evolutiva:</p>
        <pre class="wk-formula">cadena de 3 (Treecko → Grovyle → Sceptile)   20 · 40 · 100
cadena de 2 (Makuhita → Hariyama)                 40 · 100
no evoluciona (Spinda, variantes de Outland)           100</pre>
        <p><b>Hasta el Nv 100 no cambia nada</b> — Kanto y Johto enteras entregan al
        pokémon en el nivel en que estaba caído. Por encima manda el tope: un Torterra derribado en
        una cacería de 3.500 entra en el <b>Nv 100</b>, y un Turtwig, en el <b>Nv 20</b>.</p>
        <p>La <b>evolución de las especies nacionales</b> sigue la misma escalera: cuando el
        destino vive en una cacería por encima del Nv 100, el eslabón pide el <b>tope del
        destino</b> (40 o 100), no el nivel de la cacería donde aparece. Capturar en el 20,
        entrenar hasta 40, evolucionar; entrenar hasta 100, evolucionar de nuevo. <b>Las variantes
        de Outland (#2001+) no entran aquí — no evolucionan</b> (ver capítulo Evolución).</p>

        ${nota(`Cada ficha de la Pokédex tiene la línea <b>Nivel al capturar</b>, y el panel de
        caídos muestra el "→ Nv" antes de que gastes la bola. El pokémon sigue valiendo lo que
        vale — solo llega para ser entrenado, no terminado.`, 'dica')}

        <h4>Qué la aumenta</h4>
        <ul>
          <li><b>Capture Boost</b> (Tienda) — <b>duplica</b> la probabilidad por lanzamiento,
          respetando el tope de ${P(c.d.captura?.teto ?? 0.1, c.lang)}.</li>
          <li><b>Una bola mejor</b> — la Poké Ball es la más barata <i>por lanzamiento</i>, pero la
          Ultra y la Beast gastan menos tiempo.</li>
        </ul>

        <h4>Automatización</h4>
        <p>La opción <b>Lanzar poké ball</b> lanza sola a los cuerpos caídos, respetando un
        intervalo de 1,2 s. Es un <b>beneficio VIP</b> — ver
        <a data-cap="automacoes">Automatizaciones</a>.</p>`,
      };
    },
  },

  // -------------------------------------------------------------- 9. morte
  {
    id: 'morte',
    titulo: { pt: 'Desmaiar e curar', en: 'Fainting and healing', es: 'Debilitarse y curar' },
    grupo: 'luta',
    html: (c) => ({
      pt: `
        <h4>Quando UM pokémon cai</h4>
        <ol class="wk-passos">
          <li>Se a automação de <b>Revive</b> estiver ligada e você tiver o item, ele levanta com
          <b>50% do HP</b> (e a de +HP completa em seguida, se estiver ligada).</li>
          <li>Senão, o <b>próximo da equipe que estiver de pé</b> entra no lugar,
          automaticamente.</li>
        </ol>

        <h4>Quando o TIME INTEIRO cai</h4>
        <p>A hunt é suspensa e você aparece na praça do <b>Centro Pokémon</b> — uma área comum,
        com os outros jogadores andando por lá (WASD para andar). A <b>Enfermeira Joy</b> cura a
        equipe inteira de graça, quantas vezes for preciso.</p>
        <p><b>Curar não tira você de lá.</b> Sair é escolher outra área no Mapa — a hunt em que
        você estava fica guardada.</p>
        ${nota(`<b>Desmaiar contra selvagens custa ${Math.round((c.d.economia?.xpPerdidoPct ?? 10))}% do XP do nível atual</b> do treinador
        (bênção da loja reduz ou zera). O custo extra é o tempo: a volta ao Centro, a cura e o
        caminho de novo. No <a data-cap="pvp">PvP Ranqueado</a> é diferente: perder <b>não</b>
        cobra XP — o que se perde ali é <b>PR</b>.`)}

        <h4>Fechar a aba no meio da luta conta como derrota</h4>
        <p>Se você sair do jogo caçando, o servidor derruba a equipe inteira, exatamente como se
        você tivesse ficado. Não há como distinguir um cabo arrancado de um Alt+F4 no frame do
        golpe fatal — e uma regra que depende de adivinhar intenção não vale nada.</p>
        <p>Para sair limpo há o botão <b>Ir para o Centro Pokémon</b> no canto do palco. Ele
        trava por <b>3 segundos</b> a cada dano trocado.</p>

        <h4>Os itens</h4>
        <ul>
          <li><b>Revive</b> — levanta um pokémon desmaiado com <b>50%</b> do HP.</li>
          <li><b>Poção (+HP)</b> — recupera <b>40%</b> do HP máximo.</li>
          <li><b>Bless</b> (Loja) — reduz (Bless Plus e Bless Ultra) ou zera (Bless Max) a perda de
          XP da <b>próxima</b> vez que o time cair.</li>
        </ul>
        <p>Poções e revives se compram no <a data-cap="market">Market</a>, em quantidade
        ilimitada e a preço fixo.</p>

        <h4>Escape Rope</h4>
        <p>Sair de uma hunt pelo botão <b>Ir para o Centro Pokémon</b> exige <b>3 segundos</b> sem
        trocar dano — a trava existe para ninguém sumir da luta no instante do golpe fatal. A
        <b>Escape Rope</b> é o atalho pago para essa mesma saída: <b>1 💎</b> na
        <a data-cap="loja">Loja</a>, e ela te leva ao Centro <b>na hora</b>, sem espera.</p>
        <ul>
          <li>O botão fica <b>ao lado</b> do de subir ao Centro, com a quantidade que você tem.
          Sem nenhuma, ele aparece apagado.</li>
          <li>É <b>consumida</b> ao usar e <b>não</b> pode ser vendida no Mercado da Comunidade.</li>
        </ul>
`,
      en: `
        <h4>When ONE pokémon falls</h4>
        <ol class="wk-passos">
          <li>If the <b>Revive</b> automation is on and you own the item, it gets up with
          <b>50% HP</b> (and the +HP automation tops it off right after, if enabled).</li>
          <li>Otherwise, the <b>next team member still standing</b> steps in automatically.</li>
        </ol>

        <h4>When the WHOLE TEAM falls</h4>
        <p>The hunt is suspended and you appear in the <b>Pokémon Center</b> square — a shared
        area, with other players walking around (WASD to move). <b>Nurse Joy</b> heals the whole
        team for free, as many times as needed.</p>
        <p><b>Healing does not take you out.</b> Leaving means picking another area on the Map —
        the hunt you were in is remembered.</p>
        ${nota(`<b>Fainting against wilds costs ${Math.round((c.d.economia?.xpPerdidoPct ?? 10))}% of your current level's trainer XP</b>
        (shop blessings reduce or cancel it). The extra cost is time: the trip back, the heal and
        the walk out again. <a data-cap="pvp">Ranked PvP</a> is different: losing costs <b>no</b>
        XP — what you lose there is <b>PR</b>.`)}

        <h4>Closing the tab mid-fight counts as a defeat</h4>
        <p>If you leave the game while hunting, the server knocks the whole team down, exactly as
        if you had stayed. There is no way to tell a yanked cable from an Alt+F4 on the frame of
        the killing blow — and a rule that depends on guessing intent is worth nothing.</p>
        <p>To leave cleanly there is the <b>Go to the Pokémon Center</b> button at the corner of
        the stage. It locks for <b>3 seconds</b> on every point of damage traded.</p>

        <h4>The items</h4>
        <ul>
          <li><b>Revive</b> — brings a fainted pokémon back at <b>50%</b> HP.</li>
          <li><b>Potion (+HP)</b> — restores <b>40%</b> of max HP.</li>
          <li><b>Bless</b> (Shop) — reduces (Bless Plus and Bless Ultra) or zeroes (Bless Max) the
          XP loss the <b>next</b> time your team falls.</li>
        </ul>
        <p>Potions and revives are bought at the <a data-cap="market">Market</a>, unlimited and at
        a fixed price.</p>

        <h4>Escape Rope</h4>
        <p>Leaving a hunt through the <b>Go to the Pokémon Center</b> button needs <b>3 seconds</b>
        without trading damage — the lock exists so nobody vanishes from a fight on the frame of
        the killing blow. The <b>Escape Rope</b> is the paid shortcut for that same exit:
        <b>1 💎</b> in the <a data-cap="loja">Shop</a>, and it takes you to the Center
        <b>instantly</b>, with no wait.</p>
        <ul>
          <li>The button sits <b>next to</b> the Center one, showing how many you own. With none
          left it shows greyed out.</li>
          <li>It is <b>consumed</b> on use and <b>cannot</b> be sold on the Community Market.</li>
        </ul>
`,
      es: `
        <h4>Cuando cae UN pokémon</h4>
        <ol class="wk-passos">
          <li>Si la automatización de <b>Revivir</b> está activa y tienes el objeto, se levanta con
          el <b>50% del HP</b> (y la de +HP lo completa después, si está activa).</li>
          <li>Si no, entra automáticamente el <b>siguiente del equipo que siga en pie</b>.</li>
        </ol>

        <h4>Cuando cae el EQUIPO ENTERO</h4>
        <p>La cacería se suspende y apareces en la plaza del <b>Centro Pokémon</b> — una zona
        común, con otros jugadores caminando por allí (WASD para moverte). La <b>Enfermera Joy</b>
        cura al equipo entero gratis, tantas veces como haga falta.</p>
        <p><b>Curar no te saca de allí.</b> Salir es elegir otra zona en el Mapa — la cacería en la
        que estabas queda guardada.</p>
        ${nota(`<b>Debilitarse contra salvajes cuesta el ${Math.round((c.d.economia?.xpPerdidoPct ?? 10))}% del XP del nivel actual</b> del entrenador
        (las bendiciones de la tienda lo reducen o anulan). El coste extra es el tiempo: la vuelta
        al Centro, la cura y el camino de nuevo. En el <a data-cap="pvp">PvP Clasificatorio</a> es
        distinto: perder <b>no</b> cuesta XP — allí lo que se pierde es <b>PR</b>.`)}

        <h4>Cerrar la pestaña en plena pelea cuenta como derrota</h4>
        <p>Si sales del juego cazando, el servidor derriba al equipo entero, exactamente como si te
        hubieras quedado. No hay forma de distinguir un cable arrancado de un Alt+F4 en el frame del
        golpe fatal — y una regla que depende de adivinar la intención no vale nada.</p>
        <p>Para salir limpio está el botón <b>Ir al Centro Pokémon</b> en la esquina del escenario.
        Se bloquea <b>3 segundos</b> con cada daño intercambiado.</p>

        <h4>Los objetos</h4>
        <ul>
          <li><b>Revivir</b> — levanta a un pokémon debilitado con el <b>50%</b> del HP.</li>
          <li><b>Poción (+HP)</b> — recupera el <b>40%</b> del HP máximo.</li>
          <li><b>Bless</b> (Tienda) — reduce (Bless Plus y Bless Ultra) o anula (Bless Max) la
          pérdida de XP de la <b>próxima</b> vez que cae tu equipo.</li>
        </ul>
        <p>Pociones y revivires se compran en el <a data-cap="market">Market</a>, en cantidad
        ilimitada y a precio fijo.</p>

        <h4>Escape Rope</h4>
        <p>Salir de una hunt con el botón <b>Ir al Centro Pokémon</b> exige <b>3 segundos</b> sin
        intercambiar daño — el candado existe para que nadie desaparezca de la pelea justo en el
        golpe final. La <b>Escape Rope</b> es el atajo de pago para esa misma salida: <b>1 💎</b>
        en la <a data-cap="loja">Tienda</a>, y te lleva al Centro <b>al instante</b>, sin
        espera.</p>
        <ul>
          <li>El botón está <b>al lado</b> del de subir al Centro, con la cantidad que tienes. Sin
          ninguna, aparece apagado.</li>
          <li>Se <b>consume</b> al usarla y <b>no</b> se puede vender en el Mercado de la
          Comunidad.</li>
        </ul>
`,
    }),
  },

  // -------------------------------------------------------- 10. automações
  {
    id: 'automacoes',
    titulo: { pt: 'Automações', en: 'Automation', es: 'Automatizaciones' },
    grupo: 'luta',
    html: () => ({
      pt: `
        <p>Ficam na coluna da direita e valem enquanto a aba estiver aberta.</p>
        ${nota(`<b>Usar Revive</b>, <b>Usar Poções</b> e <b>Voltar à hunt</b> já vêm
        <b>ligadas</b>, com todas as poções e revives da loja já marcados — da mais barata para
        a mais cara. Você não precisa configurar nada para a hunt não parar; se quiser o
        contrário, é só desligar, e aí fica desligado.`)}

        <h4><span class="selo-vip">VIP</span> Lançar pokébola</h4>
        <p>Arremessa sozinha nos <b>corpos caídos</b>, um por corpo, respeitando 1,2 s entre
        arremessos. Escolha <b>quais bolas</b> podem ser gastas clicando nos ícones — a
        automação usa a primeira da lista que ainda tiver estoque.</p>
        ${nota(`Este recurso é <b>exclusivo de VIP</b>. Sem assinatura o interruptor abre o
        convite para a <a data-cap="loja">Loja</a>, e assim que o VIP vence a automação para
        sozinha (a sua escolha de bolas fica guardada).`, 'aviso')}

        <h4>Usar Revive ao desmaiar</h4>
        <p>Levanta o pokémon ativo com 50% do HP em vez de trocar por outro da equipe. Clique nos
        ícones para escolher <b>quais revives</b> gastar; a <b>ordem dos cliques é a ordem de
        gasto</b>. A automação <b>para</b> quando acaba tudo o que está marcado — ela não gasta o
        que você não pediu —, e por isso a conta já nasce com todos marcados. Nada escolhido =
        qualquer um, mas aí do mais <b>caro</b> para o mais barato.</p>

        <h4>Usar Poções</h4>
        <p>Mesma ideia, com as poções — e mais uma escolha: <b>a partir de que altura da vida</b>
        a poção entra. Um <b>slider de 10% a 100%</b>, de 10 em 10 (10%, 20%, 30%… até 100%).</p>
        ${tabela(
          ['Limiar', 'Para quem'],
          `<tr><td class="wk-num">10–20%</td><td>economiza poção e aceita chegar perto do nocaute</td></tr>
           <tr><td class="wk-num">30%</td><td>o meio-termo (padrão)</td></tr>
           <tr><td class="wk-num">50–100%</td><td>hunt acima do seu nível, onde um golpe tira muita vida</td></tr>`,
        )}
        <p>Um item escolhido que <b>acabou</b> continua na fila, apagado: a preferência é sua e
        não some porque o estoque zerou no meio de uma hunt.</p>

        <h4>Voltar à hunt ao morrer/reset</h4>
        <p>Se o time inteiro cair, a Enfermeira cura e a automação <b>devolve você à mesma hunt</b>
        alguns segundos depois — é o que deixa farmar de madrugada sem acordar para clicar.</p>
        <ul>
          <li><b>Só dispara com poção ou revive na bolsa.</b> Sem itens ela <b>pausa</b> e avisa no
          log e em toast, em vez de devolver você à hunt que acabou de matar seu time. Sem essa
          trava, ficar sem item de madrugada vira um laço de mortes — e cada volta cobra a
          <a data-cap="morte">perda de XP do nocaute</a>, até o seu nível cair <b>abaixo do
          mínimo dos seus próprios pokémon</b>.</li>
          <li>O interruptor <b>continua ligado</b> quando ela pausa: você não desligou nada, só
          ficou sem item. Comprar uma poção e voltar à hunt na mão já rearma tudo.</li>
          <li><b>Desistir não conta.</b> Sair da hunt pelo botão de desistência é uma decisão sua,
          não uma derrota — a automação não é acionada.</li>
        </ul>

        <h4>Automação de fora do jogo</h4>
        <p>Os <b>Termos de Uso</b> permitem automações, no jogo e no
        <a data-cap="comunidade">Mercado</a> — inclusive a <b>extensão de automação do PokéIdle</b>,
        que está no nosso Discord, no canal <b>#how-to-play</b>.</p>
        <ul>
          <li>As regras de conduta valem para todo mundo, jogando na mão ou com automação.</li>
          <li>O servidor segura rajadas de ações por segundo <b>por conta</b>, e o sorteio da
          liberação do Mercado vale igual para os dois: ser mais rápido não dá vantagem.</li>
          <li>Continua proibido usar falha do jogo para conseguir Gemas por fora da compra
          oficial.</li>
        </ul>`,
      en: `
        <p>They live in the right-hand column and run while the tab is open.</p>
        ${nota(`<b>Use Revive</b>, <b>Use Potions</b> and <b>Back to the hunt</b> come
        <b>already on</b>, with every shop potion and revive already ticked — cheapest first.
        You do not have to set anything up for the hunt to keep going; if you want the
        opposite, just switch it off and it stays off.`)}

        <h4><span class="selo-vip">VIP</span> Throw poké ball</h4>
        <p>Throws on its own at <b>fallen bodies</b>, one per body, with 1.2 s between throws. Pick
        <b>which balls</b> may be spent by clicking the icons — the automation uses the first one
        on the list that still has stock.</p>
        ${nota(`This feature is <b>VIP-only</b>. Without a subscription the switch opens an
        invitation to the <a data-cap="loja">Shop</a>, and the moment VIP expires the automation
        stops by itself (your ball choice is kept).`, 'aviso')}

        <h4>Use Revive on faint</h4>
        <p>Brings the active pokémon back at 50% HP instead of swapping to another team member.
        Click the icons to choose <b>which revives</b> to spend; the <b>click order is the spend
        order</b>. Nothing chosen = any of them.</p>

        <h4>Use Potions</h4>
        <p>Same idea with potions — plus one more choice: <b>at what health</b> the potion
        kicks in. A <b>slider from 10% to 100%</b>, in steps of 10 (10%, 20%, 30%… up to 100%).</p>
        ${tabela(
          ['Threshold', 'For whom'],
          `<tr><td class="wk-num">10–20%</td><td>saves potions and accepts flirting with a knockout</td></tr>
           <tr><td class="wk-num">30%</td><td>the middle ground (default)</td></tr>
           <tr><td class="wk-num">50–100%</td><td>hunts above your level, where one hit takes a big chunk of health</td></tr>`,
        )}
        <p>A chosen item that has <b>run out</b> stays in the queue, dimmed: the preference is
        yours and does not vanish because stock hit zero mid-hunt.</p>

        <h4>Return to hunt on death/reset</h4>
        <p>If your whole team goes down, the Nurse heals you and the automation <b>puts you back
        in the same hunt</b> a few seconds later — that is what lets you farm overnight without
        waking up to click.</p>
        <ul>
          <li><b>It only fires with a potion or a revive in the bag.</b> With no items it
          <b>pauses</b> and warns you in the log and in a toast, instead of sending you back to
          the hunt that just wiped your team. Without that lock, running out of items overnight
          becomes a death loop — and every trip back charges the
          <a data-cap="morte">knockout XP loss</a>, until your level drops <b>below the minimum
          your own pokémon require</b>.</li>
          <li>The switch <b>stays on</b> when it pauses: you did not turn anything off, you just
          ran out. Buying a potion and re-entering the hunt by hand rearms it.</li>
          <li><b>Surrendering does not count.</b> Leaving a hunt through the give-up button is
          your decision, not a defeat — the automation does not run.</li>
        </ul>

        <h4>Automation from outside the game</h4>
        <p>The <b>Terms of Use</b> allow automation, in the game and on the
        <a data-cap="comunidade">Market</a> — including the <b>PokéIdle automation extension</b>,
        available on our Discord, in the <b>#how-to-play</b> channel.</p>
        <ul>
          <li>The conduct rules apply to everyone, playing by hand or with automation.</li>
          <li>The server caps bursts of actions per second <b>per account</b>, and the Market
          release draw treats both the same: being faster gives no edge.</li>
          <li>Using a game flaw to get Gems outside the official purchase is still forbidden.</li>
        </ul>`,
      es: `
        <p>Están en la columna de la derecha y funcionan mientras la pestaña esté abierta.</p>
        ${nota(`<b>Usar Revive</b>, <b>Usar Pociones</b> y <b>Volver a la hunt</b> ya vienen
        <b>activadas</b>, con todas las pociones y revives de la tienda ya marcados — de la más
        barata a la más cara. No hace falta configurar nada para que la hunt no se detenga; si
        quieres lo contrario, basta con apagarlo, y se queda apagado.`)}

        <h4><span class="selo-vip">VIP</span> Lanzar poké ball</h4>
        <p>Lanza sola a los <b>cuerpos caídos</b>, uno por cuerpo, respetando 1,2 s entre
        lanzamientos. Elige <b>qué bolas</b> se pueden gastar haciendo clic en los iconos — la
        automatización usa la primera de la lista que aún tenga existencias.</p>
        ${nota(`Esta función es <b>exclusiva de VIP</b>. Sin suscripción el interruptor abre la
        invitación a la <a data-cap="loja">Tienda</a>, y en cuanto el VIP vence la automatización
        se detiene sola (tu elección de bolas queda guardada).`, 'aviso')}

        <h4>Usar Revivir al debilitarse</h4>
        <p>Levanta al pokémon activo con el 50% del HP en vez de cambiarlo por otro del equipo. Haz
        clic en los iconos para elegir <b>qué revivires</b> gastar; el <b>orden de los clics es el
        orden de gasto</b>. Nada elegido = cualquiera.</p>

        <h4>Usar Pociones</h4>
        <p>La misma idea, con las pociones — y una elección más: <b>a partir de qué nivel de
        vida</b> entra la poción. Un <b>deslizador de 10% a 100%</b>, de 10 en 10 (10%, 20%, 30%…
        hasta 100%).</p>
        ${tabela(
          ['Umbral', 'Para quién'],
          `<tr><td class="wk-num">10–20%</td><td>ahorra pociones y acepta rozar el nocaut</td></tr>
           <tr><td class="wk-num">30%</td><td>el término medio (por defecto)</td></tr>
           <tr><td class="wk-num">50–100%</td><td>cacerías por encima de tu nivel, donde un golpe quita mucha vida</td></tr>`,
        )}
        <p>Un objeto elegido que se <b>agotó</b> sigue en la cola, apagado: la preferencia es tuya y
        no desaparece porque el stock llegó a cero en plena cacería.</p>

        <h4>Volver a la hunt al morir/reset</h4>
        <p>Si todo el equipo cae, la Enfermera cura y la automatización <b>te devuelve a la misma
        cacería</b> unos segundos después — es lo que permite farmear de madrugada sin despertarse
        para hacer clic.</p>
        <ul>
          <li><b>Solo se activa con poción o revivir en la mochila.</b> Sin objetos se
          <b>pausa</b> y avisa en el registro y en un aviso, en vez de devolverte a la cacería que
          acaba de matar a tu equipo. Sin esa traba, quedarse sin objetos de madrugada se vuelve
          un bucle de muertes — y cada vuelta cobra la <a data-cap="morte">pérdida de XP del
          nocaut</a>, hasta que tu nivel caiga <b>por debajo del mínimo de tus propios
          pokémon</b>.</li>
          <li>El interruptor <b>sigue encendido</b> cuando se pausa: no apagaste nada, solo te
          quedaste sin objetos. Comprar una poción y volver a la cacería a mano lo rearma.</li>
          <li><b>Rendirse no cuenta.</b> Salir de una cacería por el botón de rendición es una
          decisión tuya, no una derrota — la automatización no se activa.</li>
        </ul>

        <h4>Automatización de fuera del juego</h4>
        <p>Los <b>Términos de Uso</b> permiten automatizaciones, en el juego y en el
        <a data-cap="comunidade">Mercado</a> — incluida la <b>extensión de automatización de
        PokéIdle</b>, que está en nuestro Discord, en el canal <b>#how-to-play</b>.</p>
        <ul>
          <li>Las reglas de conducta valen para todos, jugando a mano o con automatización.</li>
          <li>El servidor frena las ráfagas de acciones por segundo <b>por cuenta</b>, y el sorteo
          de la liberación del Mercado vale igual para los dos: ser más rápido no da ventaja.</li>
          <li>Sigue prohibido usar un fallo del juego para conseguir Gemas por fuera de la compra
          oficial.</li>
        </ul>`,
    }),
  },

  // ---------------------------------------------------------- 12. mapa / analyser
  {
    id: 'mapa',
    titulo: { pt: 'Mapa e Hunt Analyser', en: 'Map and Hunt Analyser', es: 'Mapa y Hunt Analyser' },
    grupo: 'mundo',
    html: (c) => ({
      pt: `
        <p>O <b>Mapa</b> é onde você escolhe a hunt. Cada marcador mostra o nível recomendado da
        área; trancadas ficam cinza até o seu treinador alcançar o nível.</p>

        <h4>Regiões e nível do treinador</h4>
        <p>Cada aba do Mapa pede um <b>nível mínimo do treinador</b> (não do pokémon). Kanto e
        Johto dividem a mesma ilustração; Hoenn, Sinnoh, Unova e Kalos têm a sua; e a aba
        <b>${ULTIMA_REGIAO.rotulo.pt}</b> reúne as gerações 7, 8 e 9 — os pokémon de Galar e Paldea
        moram lá. A <b>Outland</b> fica fora da ordem das gerações: é o mapa das variantes e dos
        drops raros (ver <a data-cap="combate">Combate</a>).</p>
        ${tabelaDeRegioes(c)}

        <h4>Ícones dos marcadores</h4>
        <p>Cada hunt mostra o retrato da espécie principal num círculo. O atlas de marcadores
        cobre centenas de looktypes publicados; se faltar algum, o jogo desenha o sprite do
        outfit na hora.</p>

        <h4>Hunt Analyser</h4>
        <p>Com o Mapa aberto, passe o mouse (ou toque) num marcador liberado: no canto superior
        direito aparece o <b>Hunt Analyser</b> — uma estimativa daquela área para a sua conta
        <b>agora</b>, com os boosts ativos. No computador ela some quando o mouse sai do
        marcador; no celular, feche pelo <b>×</b> do cabeçalho da ficha e toque em outra área.</p>
        <ul>
          <li><b>XP treinador / hora</b> e <b>XP pokémon / hora</b></li>
          <li><b>Ouro / hora</b> (pelo <code>experience</code> das espécies que spawnam lá)</li>
          <li><b>Forte contra</b> — tipos que você bate com ×2 na hunt (já amplificado)</li>
          <li><b>Fraco contra</b> — tipos com ×0,5 ou imunidade</li>
        </ul>
        ${nota(`São estimativas, não promessas: spawn aleatório, tempo andando até o alvo e
        desmaios mudam o resultado real. Serve para comparar duas hunts, não para prever a
        próxima hora ao minuto.`, 'dica')}

        <h4>Filtros</h4>
        <p>As abas do topo trocam a região (de Kanto a ${ULTIMA_REGIAO.rotulo.pt}). Dá também para
        buscar a área pelo nome, limitar o intervalo de nível da hunt, marcar <b>só liberadas</b>
        — útil quando você sobe de nível e quer ver o que abriu — e filtrar por <b>tipo</b>. Com
        um tipo marcado, <b>Fraco contra</b> mostra as hunts cujos selvagens levam ×2 ou mais de
        um golpe desse tipo, e <b>Forte contra</b> as que resistem a ele (×0,5 ou menos).</p>`,
      en: `
        <p>The <b>Map</b> is where you pick a hunt. Each marker shows the area's recommended level;
        locked ones stay grey until your trainer reaches it.</p>

        <h4>Regions and trainer level</h4>
        <p>Each Map tab requires a minimum <b>trainer level</b> (not the pokémon's). Kanto and
        Johto share one illustration; Hoenn, Sinnoh, Unova and Kalos have their own; and the
        <b>${ULTIMA_REGIAO.rotulo.en}</b> tab gathers generations 7, 8 and 9 — Galar and Paldea
        pokémon live there. <b>Outland</b> sits outside the generation order: it is the map of
        variants and rare drops (see <a data-cap="combate">Combat</a>).</p>
        ${tabelaDeRegioes(c)}

        <h4>Marker icons</h4>
        <p>Each hunt shows the main species portrait in a circle. The marker atlas covers hundreds
        of published looktypes; if one is missing, the client draws the outfit sprite on the fly.</p>

        <h4>Hunt Analyser</h4>
        <p>With the Map open, hover (or tap) an unlocked marker: the <b>Hunt Analyser</b> panel
        appears in the top-right — an estimate for that area on your account <b>right now</b>,
        with active boosts included. On a computer it goes away when the mouse leaves the marker;
        on a phone, close it with the <b>×</b> in the sheet's header and tap another area.</p>
        <ul>
          <li><b>Trainer XP / hour</b> and <b>Pokémon XP / hour</b></li>
          <li><b>Gold / hour</b> (from species <code>experience</code> that spawn there)</li>
          <li><b>Strong against</b> — types you hit for ×2 on the hunt (already amplified)</li>
          <li><b>Weak against</b> — types at ×0.5 or immunity</li>
        </ul>
        ${nota(`These are estimates, not guarantees: random spawns, walking time and faints
        change real results. Use it to compare hunts, not to predict the next hour to the minute.`,
        'dica')}

        <h4>Filters</h4>
        <p>The tabs at the top switch region (Kanto through ${ULTIMA_REGIAO.rotulo.en}). You can
        also search an area by name, limit the hunt level range, toggle <b>unlocked only</b> —
        handy after a level-up to see what opened — and filter by <b>type</b>. With a type
        selected, <b>Weak against</b> shows the hunts whose wilds take ×2 or more from a move of
        that type, and <b>Strong against</b> the ones that resist it (×0.5 or less).</p>`,
      es: `
        <p>El <b>Mapa</b> es donde eliges la cacería. Cada marcador muestra el nivel recomendado;
        las bloqueadas quedan grises hasta que tu entrenador alcance ese nivel.</p>

        <h4>Regiones y nivel del entrenador</h4>
        <p>Cada pestaña del Mapa exige un <b>nivel mínimo del entrenador</b> (no del pokémon).
        Kanto y Johto comparten la misma ilustración; Hoenn, Sinnoh, Unova y Kalos tienen la suya;
        y la pestaña <b>${ULTIMA_REGIAO.rotulo.es}</b> reúne las generaciones 7, 8 y 9 — los pokémon
        de Galar y Paldea viven allí. <b>Outland</b> queda fuera del orden de las generaciones: es
        el mapa de las variantes y de los drops raros (ver <a data-cap="combate">Combate</a>).</p>
        ${tabelaDeRegioes(c)}

        <h4>Iconos de los marcadores</h4>
        <p>Cada cacería muestra el retrato de la especie principal en un círculo. El atlas cubre
        cientos de looktypes publicados; si falta alguno, el cliente dibuja el sprite del outfit
        al vuelo.</p>

        <h4>Hunt Analyser</h4>
        <p>Con el Mapa abierto, pasa el ratón (o toca) un marcador desbloqueado: en la esquina
        superior derecha aparece el <b>Hunt Analyser</b> — una estimación de esa zona para tu
        cuenta <b>ahora</b>, con los boosts activos. En el ordenador desaparece cuando el ratón
        sale del marcador; en el móvil, ciérrala con la <b>×</b> de la cabecera de la ficha y toca
        otra zona.</p>
        <ul>
          <li><b>XP entrenador / hora</b> y <b>XP pokémon / hora</b></li>
          <li><b>Oro / hora</b> (por el <code>experience</code> de las especies que aparecen)</li>
          <li><b>Fuerte contra</b> — tipos que pegas con ×2 en la cacería (ya amplificado)</li>
          <li><b>Débil contra</b> — tipos con ×0,5 o inmunidad</li>
        </ul>
        ${nota(`Son estimaciones, no promesas: el spawn es aleatorio, el tiempo caminando y los
        debilitamientos cambian el resultado real. Sirve para comparar dos hunts, no para predecir
        la próxima hora al minuto.`, 'dica')}

        <h4>Filtros</h4>
        <p>Las pestañas de arriba cambian la región (de Kanto a ${ULTIMA_REGIAO.rotulo.es}). También
        puedes buscar la zona por nombre, limitar el rango de nivel de la cacería, marcar
        <b>solo liberadas</b> y filtrar por <b>tipo</b>. Con un tipo marcado, <b>Débil contra</b>
        muestra las cacerías cuyos salvajes reciben ×2 o más de un golpe de ese tipo, y
        <b>Fuerte contra</b> las que lo resisten (×0,5 o menos).</p>`,
    }),
  },

  // ------------------------------------------------------------- 13. guilds
  {
    id: 'guild',
    titulo: { pt: 'Guilds', en: 'Guilds', es: 'Guilds' },
    grupo: 'mundo',
    html: (c) => ({
      pt: `
        <p>Clãs <b>sem limite de tamanho</b>: chame quantos jogadores quiser. O botão fica abaixo
        do seu retrato: <b>+</b> para criar ou o brasão da guild se você já estiver numa.</p>

        <h4>Criar e gerenciar</h4>
        <ul>
          <li>Custo de criação: <b>${N(c.d.guildCusto ?? 250_000, c.lang)}</b> de ouro</li>
          <li>Escolha nome, formato do escudo, emblema e cores (mesmo vocabulário visual do outfit)</li>
          <li>O dono convida por nick, expulsa membros ou apaga a guild</li>
          <li><b>Não há teto de membros</b> — o teto é do <b>TIME</b>, logo abaixo</li>
        </ul>


        <h4>A TAG da guild</h4>
        <p>Até <b>três letras</b> ao lado do seu nick no chat, na cor que o dono escolher — em
        <b>Guild → Guild → TAG da guild</b>, e também na hora de criar a guild.</p>
        <ul>
          <li>Por padrão são as <b>três primeiras letras do nome</b> da guild: "Lua Cheia" nasce
          com <b>[LUA]</b>. Ninguém precisa configurar nada.</li>
          <li>A cor sai de uma paleta pensada para o <b>vidro preto do chat</b> — nada de tag
          invisível.</li>
          <li><b>Uma troca a cada 24 horas</b>, a mesma espera do brasão. A primeira é livre.</li>
          <li><b>ADM, MOD, GM e as outras da equipe são bloqueadas</b> (inclusive escritas com
          número, como <b>M0D</b>): o chat já marca a equipe do jogo na mesma linha, e a tag não
          pode servir para se passar por ela.</li>
          <li>A tag é um <b>retrato</b> na mensagem: trocar a tag hoje não reescreve o que você
          falou ontem.</li>
        </ul>

        <h4>O TIME da guild (a escalação)</h4>
        <p>A guild cresce sem limite, mas quem vai à <b>Guerra de Guilds</b> é o <b>time</b>:
        <b>${N(c.d.guildMaxTime ?? 10, c.lang)} jogadores</b>, escolhidos pelo <b>dono</b> em
        <b>Guild → Time da Guild</b>. É a decisão que define a força da guild no dia.</p>
        <ul>
          <li><b>Guild com ${N(c.d.guildMaxTime ?? 10, c.lang)} membros ou menos está toda escalada.</b>
          Se você é oito, os oito entram — não há nada a escolher. O editor só passa a valer
          quando a guild passa de ${N(c.d.guildMaxTime ?? 10, c.lang)}.</li>
          <li>Com trinta membros, <b>dez</b> lutam e os outros vinte são <b>reserva</b>: continuam
          na guild, no chat e no ranking, mas não entram na guerra.</li>
          <li><b>Só os escalados recebem.</b> O bônus diário do ranking de GP (XP de treinador, XP
          de pokémon e loot) e os <b>diamantes do fechamento mensal</b> vão para o time, e não
          para a lista de membros. Quem é reserva farma sem bônus de guild.</li>
          <li>Vaga que abre (alguém saiu, foi expulso) <b>fecha sozinha</b> com o membro mais
          antigo que estava de fora: o time nunca vai à guerra com lugar vazio.</li>
          <li>O <b>Time da Guild</b> (quais JOGADORES lutam) não é a <b>Minha equipe de guerra</b>
          (quais POKÉMON você leva) — são dois botões no mesmo painel, e cada escalado precisa
          dos dois.</li>
        </ul>

        <h4>GP: o placar do dia e o do mês</h4>
        <p>Cada guild ganha <b>GP</b> (Guild Points) na <b>Guerra de Guilds</b>, e esse GP entra em
        dois placares, cada um com a sua aba no <a data-cap="ranking">Ranking</a>:</p>
        <ul>
          <li><b>Guild Diário</b> — o GP da última guerra. Ele <b>zera a cada guerra</b>, e a
          posição nele decide o bônus de <b>XP do treinador, XP do pokémon e loot</b> dos
          <b>escalados</b> até a guerra seguinte. Com 0 GP não há bônus.</li>
          <li><b>Guild Global</b> — a <b>Temporada Global</b>: soma o GP de todas as guerras do mês.
          No dia 1º, às 00:00 UTC, o pódio leva <b>diamantes para cada escalado</b> e o placar
          recomeça do zero.</li>
        </ul>
        <p>Os dois prêmios são <b>do time</b>: quem está na guild mas fora da escalação não leva
        nem o bônus do dia nem o diamante do mês.</p>
        ${tabela(['Posição', 'Bônus do dia', 'Prêmio do mês (por escalado)'], linhasPremiosGuild(c))}
        <p>O botão <b>🏆 Recompensas</b>, na aba <b>Guild</b> do PvP (embaixo do replay), mostra as
        duas tabelas, quanto falta para cada virada e onde a sua guild está.</p>

        <h4>Guerra de Guilds (diária)</h4>
        <p>Uma vez por dia, às <b>22h UTC</b> (19h de Brasília), todas as guilds registradas se
        enfrentam numa arena só. Quanto mais guilds inscritas, mais GP o 1º lugar leva
        (N guilds → 1º ganha N GP, 2º ganha N−1, …). Só o <b>dono</b> registra, uma vez só — a
        guild entra <b>automaticamente todo dia</b> —, na aba <b>Guild</b> do painel de
        <a data-cap="pvp">PvP</a>.</p>
        <ul>
          <li><b>Ninguém precisa estar acordado.</b> A guerra é <b>simulada no servidor</b> com o
          <b>time</b> de quem se registrou — até ${N(c.d.guildMaxTime ?? 10, c.lang)} jogadores por guild,
          e não a guild inteira. Você não entra em arena nenhuma no horário.</li>
          <li>Entra a <b>equipe de guerra</b> que você salvou no painel; quem nunca salvou entra
          com a equipe de hunt. Ela é fotografada <b>na hora do evento</b>.</li>
          <li>Todo mundo entra <b>curado</b>: ter desmaiado antes de dormir não vira peso morto.</li>
          <li><b>Onde cada guild nasce é chaveado, como num campeonato.</b> As <b>4 guilds mais
          fortes</b> são as cabeças de chave: a 1ª nasce numa ponta da arena, a 2ª no ponto mais
          distante dela <b>a pé</b>, e a 3ª e a 4ª nos pontos mais distantes das duas. Cada vaga que
          sobra pertence à região da cabeça de chave mais próxima, e as outras guilds são repartidas
          entre as regiões em <b>serpentina</b> — numa chave de 16, 1-8-9-16, 2-7-10-15, 3-6-11-14 e
          4-5-12-13 —, para toda região ter a mesma força. Dentro da região, a mais fraca nasce mais
          perto da cabeça de chave e as fortes ficam na divisa: as favoritas só se cruzam no fim.
          A força é o <b>GP Global</b> da temporada, depois o GP do dia anterior e, empatando, a
          força das equipes. A ponta da 1ª muda a cada guerra, porque o terreno da arena não é
          simétrico.</li>
          <li>O nível conta <b>inteiro até ${N(ARENA_NIVEL_CHEIO, c.lang)}</b> e <b>comprimido</b> daí
          para cima — mais do que no <a data-cap="ginasios">ginásio</a>: nv ${N(1000, c.lang)} conta
          ${N(nivelNaGuerra(1000), c.lang)}, nv ${N(3000, c.lang)} conta ${N(nivelNaGuerra(3000), c.lang)}
          e nv ${N(10000, c.lang)} conta ${N(nivelNaGuerra(10000), c.lang)}. Dobrar o nível rende
          +${DOBRA_NA_GUERRA_PCT}%. Qualidade, potência e refino continuam valendo inteiros.</li>
          <li>Vale o <b>TM Elemental</b> de cada pokémon; o <b>TM AoE não entra</b> — na guerra o
          dano é sempre num alvo só. O <b>+25% de líder de ginásio</b> vale só na hunt (ver
          <a data-cap="ginasios">Ginásios</a>).</li>
          <li><b>A guerra dura até ${MIN_GUERRA} minutos simulados.</b> Ela acaba quando sobra uma
          guild de pé. Se passar do teto, decide a <b>fração de HP</b> que cada guild ainda tem.
          Os duelos de ginásio, do PvP Ranqueado e do Campeonato têm teto próprio, mais curto.</li>
        </ul>
        <p>Depois é só clicar em <b>assistir ao replay</b>: a guerra inteira gravada, com os
        golpes, os efeitos de tipo, os números de dano, as trocas de pokémon, o placar e o feed de
        abates (<b>jogador</b> ⚔ <b>pokémon</b> de <b>donor</b>). Dá para acelerar até 8×, afastar
        a câmera e acompanhar um lutador específico.</p>
        <p>Ao lado das Recompensas, o botão <b>📊 Análise da última guerra</b> abre os números da guerra
        inteira: <b>dano causado e recebido, abates e pokémon perdidos</b> de cada jogador, os pokémon
        que cada um pôs em campo (e quanto cada um fez), os destaques — maior dano, mais abates, o
        Pokémon da guerra, o maior golpe, o primeiro abate, o último de pé — e o placar de todas as
        guilds. Os números saem da própria fita; assistência não entra, porque a fita não separa
        ajuda de coincidência.</p>`,
      en: `
        <p>Clans with <b>no size cap</b>: invite as many players as you like. The button sits
        below your portrait: <b>+</b> to create, or your guild crest if you are already in one.</p>

        <h4>Create and manage</h4>
        <ul>
          <li>Creation cost: <b>${N(c.d.guildCusto ?? 250_000, c.lang)}</b> gold</li>
          <li>Pick name, shield shape, emblem and colours</li>
          <li>The owner invites by nick, kicks members or deletes the guild</li>
          <li><b>No member cap</b> — the cap is on the <b>ROSTER</b>, just below</li>
        </ul>


        <h4>The guild TAG</h4>
        <p>Up to <b>three letters</b> next to your nick in chat, in the colour the owner picks —
        in <b>Guild → Guild → Guild TAG</b>, and also while creating the guild.</p>
        <ul>
          <li>It defaults to the <b>first three letters of the name</b>: "Lua Cheia" is born with
          <b>[LUA]</b>. Nobody has to set anything up.</li>
          <li>The colour comes from a palette built for the <b>black glass of the chat</b> — no
          invisible tags.</li>
          <li><b>One change every 24 hours</b>, the same wait as the crest. The first one is free.</li>
          <li><b>ADM, MOD, GM and the other staff ones are blocked</b> (including the digit
          spellings, like <b>M0D</b>): the chat already marks the game's staff on that same line,
          and the tag cannot be used to pass for it.</li>
          <li>The tag is a <b>snapshot</b> on the message: changing it today does not rewrite what
          you said yesterday.</li>
        </ul>

        <h4>The guild roster</h4>
        <p>The guild grows without limit, but what goes to the <b>Guild War</b> is the
        <b>roster</b>: <b>${N(c.d.guildMaxTime ?? 10, c.lang)} players</b>, picked by the <b>owner</b> in
        <b>Guild → Guild Roster</b>. That choice is what the guild's strength is made of.</p>
        <ul>
          <li><b>A guild with ${N(c.d.guildMaxTime ?? 10, c.lang)} members or fewer is fully rostered.</b>
          If you are eight, all eight fight — there is nothing to pick. The editor only starts to
          matter once the guild goes past ${N(c.d.guildMaxTime ?? 10, c.lang)}.</li>
          <li>With thirty members, <b>ten</b> fight and the other twenty are <b>reserves</b>: still
          in the guild, the chat and the ranking, but not in the war.</li>
          <li><b>Only rostered players collect.</b> The daily GP ranking bonus (trainer XP, pokémon
          XP and loot) and the <b>diamonds from the monthly close</b> go to the roster, not to the
          member list. Reserves farm without the guild bonus.</li>
          <li>A slot that opens up (someone left or was kicked) <b>fills itself</b> with the
          longest-standing member off the roster: the team never goes to war a player short.</li>
          <li>The <b>Guild Roster</b> (which PLAYERS fight) is not <b>My war team</b> (which
          POKÉMON you bring) — two buttons in the same panel, and every rostered player needs
          both.</li>
        </ul>

        <h4>GP: the daily board and the monthly one</h4>
        <p>Each guild earns <b>GP</b> (Guild Points) in the <b>Guild War</b>, and that GP feeds two
        boards, each with its own tab in <a data-cap="ranking">Rankings</a>:</p>
        <ul>
          <li><b>Guild Daily</b> — the GP from the last war. It <b>resets every war</b>, and your
          place on it sets the <b>trainer XP, pokémon XP and loot</b> bonus for the <b>rostered
          players</b> until the next war. With 0 GP there is no bonus.</li>
          <li><b>Guild Global</b> — the <b>Global Season</b>: it adds up the GP of every war in the
          month. On the 1st, at 00:00 UTC, the podium gets <b>diamonds for each rostered player</b>
          and the board starts over.</li>
        </ul>
        <p>Both prizes belong to the <b>roster</b>: a member off it gets neither the daily bonus
        nor the monthly diamonds.</p>
        ${tabela(['Place', 'Daily bonus', 'Monthly prize (per rostered player)'], linhasPremiosGuild(c))}
        <p>The <b>🏆 Rewards</b> button, on the PvP <b>Guild</b> tab (below the replay), shows both
        tables, the time left until each reset and where your guild stands.</p>

        <h4>Guild War (daily)</h4>
        <p>Once a day, at <b>22:00 UTC</b>, every registered guild fights in a single arena. More
        registrations mean more GP for 1st place (N guilds → 1st gets N GP, 2nd gets N−1, …). Only
        the <b>owner</b> registers, just once — the guild joins <b>automatically every day</b> — on
        the <b>Guild</b> tab of the <a data-cap="pvp">PvP</a> panel.</p>
        <ul>
          <li><b>Nobody has to be awake.</b> The war is <b>simulated on the server</b> with the
          <b>roster</b> of everyone who registered — up to ${N(c.d.guildMaxTime ?? 10, c.lang)} players per
          guild, not the whole guild. You do not enter any arena at that hour.</li>
          <li>Your <b>war team</b> from the panel is the one that fights; if you never saved one,
          your hunt team goes in. It is snapshotted <b>at event time</b>.</li>
          <li>Everyone enters <b>healed</b>: having fainted before logging off is not dead
          weight.</li>
          <li><b>Where each guild spawns is seeded, like a tournament.</b> The <b>4 strongest
          guilds</b> are the top seeds: 1st starts at a corner of the arena, 2nd at the point
          farthest from it <b>on foot</b>, and 3rd and 4th at the points farthest from both. Every
          remaining spot belongs to the region of the nearest top seed, and the other guilds are
          spread across those regions in <b>snake order</b> — in a 16-guild bracket, 1-8-9-16,
          2-7-10-15, 3-6-11-14 and 4-5-12-13 —, so every region has the same strength. Inside a
          region the weakest guild spawns closest to the top seed and the strong ones sit on the
          border: the favourites only meet at the end. Strength is the season's <b>Global GP</b>,
          then the previous day's GP and, on a tie, the teams' strength. The 1st seed's corner
          changes every war, because the arena's terrain is not symmetric.</li>
          <li>Level counts <b>in full up to ${N(ARENA_NIVEL_CHEIO, c.lang)}</b> and <b>compressed</b>
          above that — harder than in the <a data-cap="ginasios">gyms</a>: lv ${N(1000, c.lang)}
          counts as ${N(nivelNaGuerra(1000), c.lang)}, lv ${N(3000, c.lang)} as
          ${N(nivelNaGuerra(3000), c.lang)} and lv ${N(10000, c.lang)} as
          ${N(nivelNaGuerra(10000), c.lang)}. Doubling your level pays +${DOBRA_NA_GUERRA_PCT}%.
          Quality, potency and refinement still count in full.</li>
          <li>Each pokémon's <b>Elemental TM</b> counts; the <b>AoE TM does not</b> — in the war
          damage is always single-target. The <b>+25% gym leader</b> bonus applies only in the hunt
          (see <a data-cap="ginasios">Gyms</a>).</li>
          <li><b>The war lasts up to ${MIN_GUERRA} simulated minutes.</b> It ends when only one guild
          is left standing. Past that cap, the <b>share of HP</b> each guild still has decides.
          Gym, Ranked PvP and Championship duels have their own, shorter cap.</li>
        </ul>
        <p>Afterwards just hit <b>watch the replay</b>: the whole war recorded, with the moves,
        the type effects, the damage numbers, the pokémon swaps, the scoreboard and the kill feed
        (<b>player</b> ⚔ <b>pokémon</b> of <b>owner</b>). You can speed it up to 8×, zoom the
        camera out and follow one specific fighter.</p>
        <p>Next to Rewards, the <b>📊 Last war analysis</b> button opens the numbers of the whole war:
        <b>damage dealt and taken, knockouts and pokémon lost</b> for every player, the pokémon each one
        put on the field (and how much each did), the highlights — most damage, most knockouts, the
        Pokémon of the war, the biggest hit, first blood, last one standing — and every guild's
        scoreboard. The numbers come from the replay itself; assists are not counted, because the
        replay cannot tell help from coincidence.</p>`,
      es: `
        <p>Clanes <b>sin límite de tamaño</b>: invita a cuantos jugadores quieras. El botón está
        debajo de tu retrato: <b>+</b> para crear, o el escudo si ya estás en una guild.</p>

        <h4>Crear y gestionar</h4>
        <ul>
          <li>Costo de creación: <b>${N(c.d.guildCusto ?? 250_000, c.lang)}</b> de oro</li>
          <li>Elige nombre, forma del escudo, emblema y colores</li>
          <li>El dueño invita por nick, expulsa o borra la guild</li>
          <li><b>No hay límite de miembros</b> — el límite es del <b>EQUIPO</b>, aquí abajo</li>
        </ul>


        <h4>La TAG de la guild</h4>
        <p>Hasta <b>tres letras</b> junto a tu nick en el chat, del color que elija el dueño — en
        <b>Guild → Guild → TAG de la guild</b>, y también al crear la guild.</p>
        <ul>
          <li>Por defecto son las <b>tres primeras letras del nombre</b>: "Lua Cheia" nace con
          <b>[LUA]</b>. Nadie tiene que configurar nada.</li>
          <li>El color sale de una paleta pensada para el <b>vidrio negro del chat</b> — nada de
          tags invisibles.</li>
          <li><b>Un cambio cada 24 horas</b>, la misma espera del escudo. El primero es libre.</li>
          <li><b>ADM, MOD, GM y las demás del equipo están bloqueadas</b> (incluso escritas con
          número, como <b>M0D</b>): el chat ya marca al equipo del juego en esa misma línea, y la
          tag no puede servir para hacerse pasar por él.</li>
          <li>La tag es una <b>foto</b> en el mensaje: cambiarla hoy no reescribe lo que dijiste
          ayer.</li>
        </ul>

        <h4>El EQUIPO de la guild (la convocatoria)</h4>
        <p>La guild crece sin límite, pero quien va a la <b>Guerra de Guilds</b> es el
        <b>equipo</b>: <b>${N(c.d.guildMaxTime ?? 10, c.lang)} jugadores</b>, elegidos por el <b>dueño</b>
        en <b>Guild → Equipo de la Guild</b>. Es la decisión que define la fuerza de la guild.</p>
        <ul>
          <li><b>Una guild con ${N(c.d.guildMaxTime ?? 10, c.lang)} miembros o menos está toda
          convocada.</b> Si sois ocho, entran los ocho — no hay nada que elegir. El editor empieza
          a valer cuando la guild pasa de ${N(c.d.guildMaxTime ?? 10, c.lang)}.</li>
          <li>Con treinta miembros, <b>diez</b> luchan y los otros veinte son <b>reserva</b>: siguen
          en la guild, en el chat y en la clasificación, pero no entran en la guerra.</li>
          <li><b>Solo los convocados cobran.</b> El bonus diario del ranking de GP (XP de
          entrenador, XP de pokémon y loot) y los <b>diamantes del cierre mensual</b> van al
          equipo, no a la lista de miembros. La reserva farmea sin bonus de guild.</li>
          <li>La plaza que se abre (alguien salió o fue expulsado) <b>se llena sola</b> con el
          miembro más antiguo que estaba fuera: el equipo nunca va a la guerra con un hueco.</li>
          <li>El <b>Equipo de la Guild</b> (qué JUGADORES luchan) no es <b>Mi equipo de guerra</b>
          (qué POKÉMON llevas) — son dos botones del mismo panel, y cada convocado necesita los
          dos.</li>
        </ul>

        <h4>GP: el marcador del día y el del mes</h4>
        <p>Cada guild gana <b>GP</b> (Guild Points) en la <b>Guerra de Guilds</b>, y ese GP entra en
        dos marcadores, cada uno con su pestaña en la <a data-cap="ranking">Clasificación</a>:</p>
        <ul>
          <li><b>Guild Diaria</b> — el GP de la última guerra. Se <b>reinicia en cada guerra</b>, y
          el puesto en ella decide el bonus de <b>XP del entrenador, XP del pokémon y loot</b> de
          los <b>convocados</b> hasta la guerra siguiente. Con 0 GP no hay bonus.</li>
          <li><b>Guild Global</b> — la <b>Temporada Global</b>: suma el GP de todas las guerras del
          mes. El día 1, a las 00:00 UTC, el podio se lleva <b>diamantes para cada convocado</b> y
          el marcador vuelve a cero.</li>
        </ul>
        <p>Los dos premios son <b>del equipo</b>: quien está en la guild pero fuera de la
        convocatoria no recibe ni el bonus del día ni el diamante del mes.</p>
        ${tabela(['Posición', 'Bonus del día', 'Premio del mes (por convocado)'], linhasPremiosGuild(c))}
        <p>El botón <b>🏆 Recompensas</b>, en la pestaña <b>Guild</b> del PvP (debajo del replay),
        muestra las dos tablas, cuánto falta para cada cambio y dónde está tu guild.</p>

        <h4>Guerra de Guilds (diaria)</h4>
        <p>Una vez al día, a las <b>22:00 UTC</b>, todas las guilds registradas se enfrentan en una
        sola arena. Cuantas más guilds inscritas, más GP se lleva el 1º lugar (N guilds → 1º gana
        N GP, 2º gana N−1, …). Solo el <b>dueño</b> registra, una sola vez — la guild entra
        <b>automáticamente cada día</b> —, en la pestaña <b>Guild</b> del panel de
        <a data-cap="pvp">PvP</a>.</p>
        <ul>
          <li><b>Nadie necesita estar despierto.</b> La guerra se <b>simula en el servidor</b> con
          el <b>equipo</b> de quien se registró — hasta ${N(c.d.guildMaxTime ?? 10, c.lang)}
          jugadores por guild, no la guild entera. No entras a ninguna arena a esa hora.</li>
          <li>Entra el <b>equipo de guerra</b> que guardaste en el panel; quien nunca guardó entra
          con el equipo de cacería. Se fotografía <b>en el momento del evento</b>.</li>
          <li>Todos entran <b>curados</b>: haber caído antes de dormir no se vuelve peso
          muerto.</li>
          <li><b>Dónde nace cada guild se reparte como el cuadro de un campeonato.</b> Las <b>4
          guilds más fuertes</b> son las cabezas de serie: la 1ª nace en una esquina de la arena, la
          2ª en el punto más lejano de ella <b>a pie</b>, y la 3ª y la 4ª en los puntos más lejanos
          de las dos. Cada hueco que queda pertenece a la región de la cabeza de serie más cercana, y
          las demás guilds se reparten entre esas regiones en <b>serpentina</b> — en un cuadro de 16,
          1-8-9-16, 2-7-10-15, 3-6-11-14 y 4-5-12-13 —, para que cada región tenga la misma fuerza.
          Dentro de la región, la más débil nace más cerca de la cabeza de serie y las fuertes quedan
          en la frontera: las favoritas solo se cruzan al final. La fuerza es el <b>GP Global</b> de
          la temporada, después el GP del día anterior y, si empatan, la fuerza de los equipos. La
          esquina de la 1ª cambia en cada guerra, porque el terreno de la arena no es
          simétrico.</li>
          <li>El nivel cuenta <b>entero hasta ${N(ARENA_NIVEL_CHEIO, c.lang)}</b> y <b>comprimido</b>
          por encima — más que en el <a data-cap="ginasios">gimnasio</a>: nv ${N(1000, c.lang)}
          cuenta ${N(nivelNaGuerra(1000), c.lang)}, nv ${N(3000, c.lang)} cuenta
          ${N(nivelNaGuerra(3000), c.lang)} y nv ${N(10000, c.lang)} cuenta
          ${N(nivelNaGuerra(10000), c.lang)}. Duplicar el nivel rinde +${DOBRA_NA_GUERRA_PCT}%.
          Calidad, potencia y refinado siguen valiendo enteros.</li>
          <li>Vale el <b>TM Elemental</b> de cada pokémon; el <b>TM AoE no entra</b> — en la guerra
          el daño siempre es a un solo objetivo. El <b>+25% de líder de gimnasio</b> vale solo en la
          cacería (ver <a data-cap="ginasios">Gimnasios</a>).</li>
          <li><b>La guerra dura hasta ${MIN_GUERRA} minutos simulados.</b> Termina cuando queda una
          sola guild en pie. Si pasa del tope, decide la <b>fracción de HP</b> que le queda a cada
          guild. Los duelos de gimnasio, del PvP Clasificatorio y del Campeonato tienen su propio
          tope, más corto.</li>
        </ul>
        <p>Después basta con pulsar <b>ver el replay</b>: la guerra entera grabada, con los
        golpes, los efectos de tipo, los números de daño, los cambios de pokémon, el marcador y el
        feed de derrotas (<b>jugador</b> ⚔ <b>pokémon</b> de <b>dueño</b>). Se puede acelerar hasta
        8×, alejar la cámara y seguir a un luchador concreto.</p>
        <p>Junto a Recompensas, el botón <b>📊 Análisis de la última guerra</b> abre los números de la
        guerra entera: <b>daño causado y recibido, derrotas y pokémon perdidos</b> de cada jugador, los
        pokémon que cada uno puso en campo (y cuánto hizo cada uno), los destacados — mayor daño, más
        derrotas, el Pokémon de la guerra, el mayor golpe, la primera derrota, el último en pie — y el
        marcador de todas las guilds. Los números salen de la propia grabación; las asistencias no
        cuentan, porque la grabación no separa ayuda de coincidencia.</p>`,
    }),
  },

  // ------------------------------------------------------- 13b. Casa e XP Share
  //
  // Como todo capítulo desta tela, NENHUM número aqui é escrito à mão: as raridades, os
  // pesos do sorteio, o teto de fragmentos e as chances de drop vêm todos de `estado.casas`,
  // que o servidor manda no welcome a partir das mesmas constantes que ele usa para decidir.
  // Balancear o `xpShare` de uma raridade muda esta página junto.
  {
    id: 'casa',
    titulo: { pt: 'Casa e XP Share', en: 'House & XP Share', es: 'Casa y XP Share' },
    grupo: 'mundo',
    html: (c) => ({
      pt: `
        <p>A <b>Casa</b> é o que faz a sua <b>equipe</b> subir junto com o pokémon de batalha. Dentro dela
        ficam os <b>bonecos</b>, e cada boneco é um <b>posto de XP Share</b>: você registra ali
        um pokémon da sua <b>equipe</b>, e ele passa a receber uma fatia do XP que o seu pokémon
        de batalha ganha na hunt.</p>

        <h4>As cinco casas</h4>
        <p>O que muda de uma para a outra é <b>o tamanho da fatia</b>, e não o tamanho da casa.
        Quatro delas têm <b>um posto só</b>; a Lendária é a única com dois:</p>
        ${tabelaDeCasas(c)}

        <h4>Como conseguir uma</h4>
        <p>Um caminho só: <b>${N(custoFragCasa(c), c.lang)} Fragmentos de Chave</b> na bancada
        <b>Fabricar Casa</b> do <b>Professor Carvalho</b>, no Centro Pokémon. A raridade é
        <b>sorteada</b> — não se escolhe qual casa vem.</p>

        <p>A Casa <b>não se compra pronta</b> — só se fabrica com fragmentos dropados na Outland.
        Cada casa sai com um <b>número do servidor</b> — quem tirou a primeira ficou com a
        <b>#000001</b> — e você pode ter <b>quantas quiser</b>. O teto é de <b>uso</b>: até
        <b>${N(maxCasasEmUso(c), c.lang)} casas</b> ficam em uso ao mesmo tempo, cada uma com os seus
        postos, e só elas repartem XP. As outras ficam <b>guardadas</b> — você escolhe quais usar no
        botão <b>Casa</b>, e guardar uma tira do XP Share os pokémon dos postos dela. Casa nova entra
        em uso sozinha enquanto houver vaga.</p>

        ${nota(`<b>Fragmentos de Chave não têm teto por conta.</b> Caem na Outland
        (${pctFragChave(c)} por derrota, ~${mediaFragChave(c)} kills em média).${dicaOutlandTiers(c)} E se compram e
        vendem no <a data-cap="comunidade">Mercado da Comunidade</a>, como a casa pronta.`, 'dica')}

        <p>A <b>casa pronta</b> é negociável — anuncie a sua pelo <b>número</b> na aba Casa do
        Mercado. Ao anunciar, os pokémon dos postos <b>daquela casa</b> saem do XP Share, e não
        voltam se você cancelar o anúncio: a casa volta vazia.</p>

        <h4>Como funciona o XP Share</h4>
        <p>Abra o botão <b>Casa</b> (ou entre nela e clique no boneco) e escolha <b>um pokémon da
        sua equipe</b> para cada posto — <b>um pokémon só ocupa um posto</b>, em todas as suas
        casas. A partir
        daí, a cada selvagem que você derruba, ele recebe a <b>fatia da sua casa</b> (a coluna
        "XP Share" da tabela acima) do XP que o seu pokémon de <b>batalha</b> ganhou naquele
        abate. Os seus multiplicadores de <b>XP de pokémon</b> (boost, VIP, guild, evento) já
        estão dentro desse número.</p>

        <p><b>O registrado não pode ser o que está lutando.</b> Se você registrar o Charizard e
        for caçar com o Charizard, ele não recebe nada — ele já leva o XP inteiro. Registre o
        Charizard e cace com o Squirtle, e é o Charizard que sobe junto.</p>

        <p>A fatia é calculada sobre o <b>XP da hunt em que você está</b>, e é isso que muda tudo
        em relação ao treino antigo: caçando numa hunt de nível 600, 75% de cada abate é muito;
        caçando numa hunt de nível 10, 75% ainda rende — mas bem menos em número absoluto. Um
        pokémon nível 600 registrado enquanto você caça no nível 10 sobe — devagar, mas sobe.</p>

        ${nota(`<b>Ninguém perde XP: a fatia é EXTRA.</b> Este é o mal-entendido mais comum do
        jogo, então vale dito com todas as letras: o seu pokémon de <b>batalha</b> fica com
        <b>100% do XP, sempre</b>. A fatia do XP Share é <b>criada por cima</b> — ela não sai do
        que ele ganhou e não divide nada com ninguém.`, 'atencao')}

        <p>Num abate que dá <b>1.000</b> de XP, com uma casa <b>Rara</b> (75%), o que acontece
        é isto:</p>
        <ul>
          <li>pokémon de <b>batalha</b>: <b>1.000</b> — os 100% de sempre, intactos</li>
          <li>pokémon <b>registrado</b> no boneco: <b>+750</b></li>
          <li>total que entrou na sua conta: <b>1.750</b></li>
        </ul>

        ${nota(`<b>Três limites que valem a pena saber de cor.</b>
        (1) Só a <b>EQUIPE</b> — pokémon parado no Depot não recebe nada (o <b>item</b> Exp.
        Share, logo abaixo, é diferente nisso).
        (2) O <b>treinador</b> não ganha XP extra, e nenhum outro pokémon além do registrado.
        (3) Sem hunt não há fatia: a porcentagem é calculada <b>sobre o XP de um abate</b>, então
        sem abate não há sobre o que calcular. Com a aba fechada, não acontece nada.`)}

        <h4>O item Exp. Share (o que se segura)</h4>
        <p>Existe também um <b>item</b> chamado <b>Exp. Share</b>, comprado na Loja por diamantes.
        Ele não tem nada a ver com a casa nem com os bonecos: ele é <b>segurado</b> por um
        pokémon, e vale sozinho — quem não tem casa nenhuma pode usá-lo.</p>

        <p>Quem estiver segurando um recebe <b>+${pctXpShareHeld(c)}%</b> do XP que o seu pokémon
        de batalha ganhou em cada abate. E vale a mesma regra de cima, que é onde quase todo mundo
        se confunde: <b>não é ${100 - pctXpShareHeld(c)}% para um e ${pctXpShareHeld(c)}% para o
        outro</b>. O de batalha continua com os <b>100%</b>, e os ${pctXpShareHeld(c)}% são um
        acréscimo em cima disso.</p>

        <p>Naquele mesmo abate de <b>1.000</b> de XP, com um pokémon segurando o item:</p>
        <ul>
          <li>pokémon de <b>batalha</b>: <b>1.000</b></li>
          <li>pokémon <b>segurando</b> o Exp. Share: <b>+${Math.round(10 * pctXpShareHeld(c))}</b></li>
        </ul>

        ${nota(`<b>O item funciona no Depot.</b> É a diferença que mais importa em relação aos
        bonecos da casa: o boneco só alimenta pokémon <b>da equipe</b>, e o Exp. Share alimenta
        quem estiver segurando ele, esteja na equipe ou guardado no <b>Depot</b>.`, 'dica')}

        <ul>
          <li><b>Empilha com a casa.</b> Um pokémon registrado no boneco E segurando um Exp.
          Share recebe as duas coisas.</li>
          <li><b>Cada item rende os seus ${pctXpShareHeld(c)}%.</b> Dois pokémon segurando dois
          Exp. Share ganham ${pctXpShareHeld(c)}% cada um — eles não repartem entre si.</li>
          <li><b>Quem está lutando não ganha o próprio bônus.</b> Se o pokémon de batalha estiver
          segurando o item, ele não recebe nada a mais: já leva os 100%.</li>
          <li><b>Não é negociável.</b> O Exp. Share nasce na Loja e morre na conta que comprou —
          não vai para o Mercado.</li>
          <li><b>Trocar de portador tem espera de 1 minuto</b> entre equipar e desequipar.</li>
        </ul>

        ${nota(`<b>A escolha fica guardada.</b> Diferente do treino antigo, sair do jogo não
        esvazia os postos — quando você voltar, o mesmo pokémon continua registrado. O posto só
        se esvazia sozinho se aquele pokémon sair da equipe, for vendido ou for para a
        vitrine.`, 'dica')}

        <h4>Entrar em casa</h4>
        <p>Pelo botão <b>Casa</b>, em qualquer uma das suas — mas só <b>a partir do Centro
        Pokémon</b> (ou de dentro de outra casa): elas ficam em Cerulean. Lá dentro você anda com
        <b>W A S D</b>, vê quem está registrado ao lado de cada boneco e tem os botões
        <b>Escolher pokémon</b> e <b>Sair de casa</b>. Entrar é só para <b>escolher</b>: o XP
        Share já estava valendo, e sair não interrompe nada.</p>`,
      en: `
        <p>The <b>House</b> is what makes your <b>team</b> level alongside your battling pokémon. Inside it are
        the <b>dummies</b>, and each dummy is an <b>XP Share post</b>: you register one pokémon
        from your <b>team</b> there, and it starts receiving a share of the XP your battling
        pokémon earns on the hunt.</p>

        <h4>The five houses</h4>
        <p>What changes between them is <b>the size of the share</b>, not the size of the house.
        Four of them hold <b>a single post</b>; the Legendary is the only one with two:</p>
        ${tabelaDeCasas(c)}

        <h4>How to get one</h4>
        <p>One path only: <b>${N(custoFragCasa(c), c.lang)} Key Fragments</b> at the
        <b>Craft House</b> bench at <b>Professor Oak</b>, in the Pokémon Center. The rarity is
        <b>rolled</b> — you don't pick which house you get.</p>

        <p>A House <b>cannot be bought ready-made</b> — you craft it only with fragments dropped
        in Outland. Every house comes with a <b>server number</b> — whoever rolled the first one got
        <b>#000001</b> — and you can own <b>as many as you like</b>. The cap is on <b>use</b>: up to
        <b>${N(maxCasasEmUso(c), c.lang)} houses</b> are in use at the same time, each with its own
        posts, and only they share XP. The rest stay <b>stored</b> — you pick which ones to use from
        the <b>House</b> button, and storing one takes the pokémon on its posts out of XP Share. A new
        house goes into use on its own while there is a free spot.</p>

        ${nota(`<b>Key Fragments have no per-account cap.</b> They drop in Outland
        (${pctFragChave(c)} per kill, ~${mediaFragChave(c)} kills on average).${dicaOutlandTiers(c)} They are also
        bought and sold on the <a data-cap="comunidade">Community Market</a>, like the finished house.`, 'dica')}

        <p>The <b>finished house</b> is tradeable — list it by its <b>number</b> on the House tab.
        When you list it, the pokémon on <b>that house's</b> posts leave XP Share, and they don't come
        back if you cancel the listing: the house returns empty.</p>

        <h4>How XP Share works</h4>
        <p>Open the <b>House</b> button (or go inside and click the dummy) and pick <b>one pokémon
        from your team</b> for each post — <b>a pokémon holds only one post</b>, across all your
        houses. From
        then on, every wild you knock down gives it <b>your house's share</b> (the "XP Share"
        column above) of the XP your <b>battling</b> pokémon earned on that kill. Your
        <b>pokémon XP</b> multipliers (boost, VIP, guild, event) are already inside that number.</p>

        <p><b>The registered one cannot be the one fighting.</b> Register Charizard and go hunting
        with Charizard, and it gets nothing — it already takes the full XP. Register Charizard and
        hunt with Squirtle, and Charizard is the one levelling alongside.</p>

        <p>The share is calculated on <b>the XP of the hunt you are actually on</b>, and that is
        what changes everything versus the old training: on a level 600 hunt, 75% of every kill is
        a lot; on a level 10 hunt, 75% still pays — but much less in absolute numbers. A level 600
        pokémon registered while you hunt at level 10 still levels — slowly, but it does.</p>

        ${nota(`<b>Nobody loses XP: the share is EXTRA.</b> This is the most common
        misunderstanding in the game, so here it is in plain words: your <b>battling</b> pokémon
        keeps <b>100% of the XP, always</b>. The XP Share slice is <b>created on top</b> — it does
        not come out of what it earned, and it splits nothing with anyone.`, 'atencao')}

        <p>On a kill worth <b>1,000</b> XP, with a <b>Rare</b> house (75%), what happens is:</p>
        <ul>
          <li><b>battling</b> pokémon: <b>1,000</b> — the usual 100%, untouched</li>
          <li>pokémon <b>registered</b> at the dummy: <b>+750</b></li>
          <li>total credited to your account: <b>1,750</b></li>
        </ul>

        ${nota(`<b>Three limits worth memorising.</b>
        (1) <b>TEAM</b> only — a pokémon sitting in the Depot gets nothing (the Exp. Share
        <b>item</b>, just below, differs on exactly this).
        (2) The <b>trainer</b> gains no extra XP, and neither does anyone but the registered one.
        (3) No hunt, no share: the percentage is worked out <b>on the XP of a kill</b>, so with no
        kill there is nothing to work it out on. With the tab closed, nothing happens.`)}

        <h4>The Exp. Share item (the held one)</h4>
        <p>There is also an <b>item</b> called <b>Exp. Share</b>, bought in the Shop with diamonds.
        It has nothing to do with the house or the dummies: it is <b>held</b> by a pokémon and
        works on its own — you can use it with no house at all.</p>

        <p>Whoever holds one gets <b>+${pctXpShareHeld(c)}%</b> of the XP your battling pokémon
        earned on each kill. And the rule above applies here too, which is where nearly everyone
        gets confused: <b>it is not ${100 - pctXpShareHeld(c)}% for one and ${pctXpShareHeld(c)}%
        for the other</b>. The battler still keeps the full <b>100%</b>, and the
        ${pctXpShareHeld(c)}% is added on top of that.</p>

        <p>On that same <b>1,000</b> XP kill, with a pokémon holding the item:</p>
        <ul>
          <li><b>battling</b> pokémon: <b>1,000</b></li>
          <li>pokémon <b>holding</b> the Exp. Share: <b>+${Math.round(10 * pctXpShareHeld(c))}</b></li>
        </ul>

        ${nota(`<b>The item works in the Depot.</b> That is the difference that matters most
        against the house dummies: a dummy only feeds a pokémon <b>on your team</b>, while the
        Exp. Share feeds whoever holds it, on the team or stored in the <b>Depot</b>.`, 'dica')}

        <ul>
          <li><b>It stacks with the house.</b> A pokémon registered at a dummy AND holding an
          Exp. Share receives both.</li>
          <li><b>Each item pays its own ${pctXpShareHeld(c)}%.</b> Two pokémon holding two
          Exp. Shares get ${pctXpShareHeld(c)}% each — they do not split it between them.</li>
          <li><b>The one fighting gets no bonus of its own.</b> If the battling pokémon is holding
          the item, it receives nothing extra: it already takes the 100%.</li>
          <li><b>Not tradeable.</b> The Exp. Share is born in the Shop and dies on the account
          that bought it — it never reaches the Market.</li>
          <li><b>Switching holders has a 1-minute wait</b> between equipping and unequipping.</li>
        </ul>

        ${nota(`<b>Your pick is remembered.</b> Unlike the old training, logging out doesn't empty
        the posts — the same pokémon is still registered when you come back. A post only clears
        itself if that pokémon leaves the team, is sold, or goes to the market.`, 'dica')}

        <h4>Entering the house</h4>
        <p>From the <b>House</b> button, into any of yours — but only <b>from the Pokémon Center</b>
        (or from inside another house): they are in Cerulean. Inside you walk with
        <b>W A S D</b>, see who is registered next to each dummy, and get the <b>Pick a
        pokémon</b> and <b>Leave house</b> buttons. Going in is just to <b>choose</b>: XP Share
        was already running, and leaving doesn't interrupt anything.</p>`,
      es: `
        <p>La <b>Casa</b> es lo que hace subir a tu <b>equipo</b> junto con el pokémon de batalla. Dentro están los
        <b>muñecos</b>, y cada muñeco es un <b>puesto de XP Share</b>: registras ahí un pokémon de
        tu <b>equipo</b>, y pasa a recibir una porción de la XP que tu pokémon de batalla gana en
        la hunt.</p>

        <h4>Las cinco casas</h4>
        <p>Lo que cambia de una a otra es <b>el tamaño de la porción</b>, no el tamaño de la casa.
        Cuatro tienen <b>un solo puesto</b>; la Legendaria es la única con dos:</p>
        ${tabelaDeCasas(c)}

        <h4>Cómo conseguir una</h4>
        <p>Un solo camino: <b>${N(custoFragCasa(c), c.lang)} Fragmentos de Llave</b> en el banco
        <b>Fabricar Casa</b> del <b>Profesor Oak</b>, en el Centro Pokémon. La rareza se
        <b>sortea</b> — no se elige qué casa sale.</p>

        <p>La Casa <b>no se compra hecha</b> — solo se fabrica con fragmentos que caen en Outland.
        Cada casa sale con un <b>número del servidor</b> — quien sacó la primera se quedó con la
        <b>#000001</b> — y puedes tener <b>todas las que quieras</b>. El tope es de <b>uso</b>: hasta
        <b>${N(maxCasasEmUso(c), c.lang)} casas</b> están en uso al mismo tiempo, cada una con sus
        puestos, y solo ellas reparten XP. Las demás quedan <b>guardadas</b> — eliges cuáles usar en el
        botón <b>Casa</b>, y guardar una saca del XP Share a los pokémon de sus puestos. Una casa nueva
        entra en uso sola mientras haya hueco.</p>

        ${nota(`<b>Los Fragmentos de Llave no tienen límite por cuenta.</b> Caen en Outland
        (${pctFragChave(c)} por derrota, ~${mediaFragChave(c)} kills de media).${dicaOutlandTiers(c)} Y se compran y
        venden en el <a data-cap="comunidade">Mercado de la Comunidad</a>, como la casa terminada.`, 'dica')}

        <p>La <b>casa terminada</b> sí es negociable — anúnciala por su <b>número</b> en la pestaña
        Casa. Al anunciarla, los pokémon de los puestos <b>de esa casa</b> salen del XP Share, y no
        vuelven si cancelas el anuncio: la casa vuelve vacía.</p>

        <h4>Cómo funciona el XP Share</h4>
        <p>Abre el botón <b>Casa</b> (o entra y haz clic en el muñeco) y elige <b>un pokémon de tu
        equipo</b> para cada puesto — <b>un pokémon solo ocupa un puesto</b>, en todas tus casas.
        Desde
        ahí, cada salvaje que derribas le da la <b>porción de tu casa</b> (la columna "XP Share"
        de la tabla de arriba) de la XP que tu pokémon de <b>batalla</b> ganó en esa derrota. Tus
        multiplicadores de <b>XP de pokémon</b> (boost, VIP, guild, evento) ya están dentro de ese
        número.</p>

        <p><b>El registrado no puede ser el que está peleando.</b> Si registras al Charizard y
        cazas con el Charizard, no recibe nada — ya se lleva la XP entera. Registra al Charizard y
        caza con el Squirtle, y es el Charizard el que sube en paralelo.</p>

        <p>La porción se calcula sobre el <b>XP de la hunt en la que estás</b>, y eso lo cambia
        todo respecto al entrenamiento antiguo: cazando en una hunt de nivel 600, el 75% de cada
        derrota es mucho; en una de nivel 10, el 75% sigue pagando — pero mucho menos en números
        absolutos. Un pokémon nivel 600 registrado mientras cazas en nivel 10 sube — despacio,
        pero sube.</p>

        ${nota(`<b>Nadie pierde XP: la porción es EXTRA.</b> Este es el malentendido más común del
        juego, así que va con todas las letras: tu pokémon de <b>batalla</b> se queda con el
        <b>100% del XP, siempre</b>. La porción del XP Share se <b>crea por encima</b> — no sale
        de lo que él ganó y no reparte nada con nadie.`, 'atencao')}

        <p>En una derrota que da <b>1.000</b> de XP, con una casa <b>Rara</b> (75%), pasa esto:</p>
        <ul>
          <li>pokémon de <b>batalla</b>: <b>1.000</b> — el 100% de siempre, intacto</li>
          <li>pokémon <b>registrado</b> en el muñeco: <b>+750</b></li>
          <li>total que entró en tu cuenta: <b>1.750</b></li>
        </ul>

        ${nota(`<b>Tres límites que conviene saber.</b>
        (1) Solo el <b>EQUIPO</b> — un pokémon parado en el Depot no recibe nada (el <b>ítem</b>
        Exp. Share, aquí abajo, se diferencia justo en eso).
        (2) El <b>entrenador</b> no gana XP extra, y ningún otro pokémon salvo el registrado.
        (3) Sin hunt no hay porción: el porcentaje se calcula <b>sobre el XP de una derrota</b>,
        así que sin derrota no hay sobre qué calcular. Con la pestaña cerrada no pasa nada.`)}

        <h4>El ítem Exp. Share (el que se lleva)</h4>
        <p>También existe un <b>ítem</b> llamado <b>Exp. Share</b>, comprado en la Tienda con
        diamantes. No tiene nada que ver con la casa ni con los muñecos: lo <b>lleva</b> un pokémon
        y funciona solo — se puede usar sin tener casa alguna.</p>

        <p>Quien lo lleve recibe <b>+${pctXpShareHeld(c)}%</b> del XP que tu pokémon de batalla
        ganó en cada derrota. Y vale la misma regla de arriba, que es donde casi todos se
        confunden: <b>no es ${100 - pctXpShareHeld(c)}% para uno y ${pctXpShareHeld(c)}% para el
        otro</b>. El de batalla sigue con el <b>100%</b>, y el ${pctXpShareHeld(c)}% es un añadido
        encima de eso.</p>

        <p>En esa misma derrota de <b>1.000</b> de XP, con un pokémon llevando el ítem:</p>
        <ul>
          <li>pokémon de <b>batalla</b>: <b>1.000</b></li>
          <li>pokémon que <b>lleva</b> el Exp. Share: <b>+${Math.round(10 * pctXpShareHeld(c))}</b></li>
        </ul>

        ${nota(`<b>El ítem funciona en el Depot.</b> Es la diferencia que más importa frente a los
        muñecos de la casa: el muñeco solo alimenta a un pokémon <b>del equipo</b>, mientras que el
        Exp. Share alimenta a quien lo lleve, esté en el equipo o guardado en el
        <b>Depot</b>.`, 'dica')}

        <ul>
          <li><b>Se acumula con la casa.</b> Un pokémon registrado en el muñeco Y llevando un
          Exp. Share recibe las dos cosas.</li>
          <li><b>Cada ítem rinde su ${pctXpShareHeld(c)}%.</b> Dos pokémon llevando dos Exp. Share
          ganan ${pctXpShareHeld(c)}% cada uno — no lo reparten entre sí.</li>
          <li><b>El que está peleando no gana su propio bono.</b> Si el pokémon de batalla lleva el
          ítem, no recibe nada de más: ya se lleva el 100%.</li>
          <li><b>No es negociable.</b> El Exp. Share nace en la Tienda y muere en la cuenta que lo
          compró — no llega al Mercado.</li>
          <li><b>Cambiar de portador tiene una espera de 1 minuto</b> entre equipar y desequipar.</li>
        </ul>

        ${nota(`<b>Tu elección queda guardada.</b> A diferencia del entrenamiento antiguo, salir
        del juego no vacía los puestos — al volver, el mismo pokémon sigue registrado. Un puesto
        solo se vacía solo si ese pokémon sale del equipo, se vende o va al mercado.`, 'dica')}

        <h4>Entrar en casa</h4>
        <p>Desde el botón <b>Casa</b>, en cualquiera de las tuyas — pero solo <b>desde el Centro
        Pokémon</b> (o desde dentro de otra casa): están en Cerulean. Dentro caminas con
        <b>W A S D</b>, ves quién está registrado junto a cada muñeco y tienes los botones
        <b>Elegir pokémon</b> y <b>Salir de casa</b>. Entrar es solo para <b>elegir</b>: el XP
        Share ya estaba valiendo, y salir no interrumpe nada.</p>`,
    }),
  },

  // ------------------------------------------------------------- Bicicletas
  //
  // Logo depois da Casa: são as duas coisas que o Professor Carvalho fabrica com fragmento da
  // Outland, com a mesma escada de raridade. Números todos de `estado.bicicletas`.
  {
    id: 'bicicletas',
    titulo: { pt: 'Bicicletas', en: 'Bicycles', es: 'Bicicletas' },
    grupo: 'mundo',
    html: (c) => ({
      pt: `
        <p>A <b>bicicleta</b> é a progressão de <b>mobilidade</b> do jogo. Na hunt, boa parte do tempo
        o seu pokémon está <b>andando</b> de um selvagem até o outro — e é esse caminho que ela
        encurta. Vale para o <b>pokémon</b> e para o <b>treinador</b>, na hunt e na praça de
        Cerulean.</p>

        <h4>As cinco bicicletas</h4>
        <p>A raridade decide o quanto ela acelera. "Tempo de cada passo" é quanto um passo leva
        comparado a andar a pé (100%): na Lendária, o passo dura a <b>metade</b>.</p>
        ${tabelaDeBicicletas(c)}

        <h4>Como conseguir uma</h4>
        <p>Todo abate na <b>Outland</b> pode soltar um <b>Fragmento de Bicicleta</b>
        (${P(chanceFragBike(c), c.lang)} por derrota, ~${N(Math.round(1 / chanceFragBike(c)), c.lang)}
        kills em média).${dicaOutlandTiers(c)} O Loot Boost também aumenta a chance.</p>

        <p>Com <b>${N(custoFragBike(c), c.lang)} fragmentos</b>, a bancada <b>Fabricar Bicicleta</b> do
        <b>Professor Carvalho</b>, no Centro Pokémon, monta uma bicicleta. A raridade é
        <b>sorteada</b>, com as chances da tabela acima — as mesmas da <a data-cap="casa">Casa</a>.</p>

        <p>Cada bicicleta sai com um <b>número do servidor</b> — a primeira tirada é a <b>#000001</b> —,
        e é por ele que ela se equipa e se anuncia. O <b>Registro de Bikes</b>, no botão <b>Casa</b>,
        mostra todas as bikes já abertas, quem tirou cada uma e quais estão à venda.</p>

        <p>Bicicleta e fragmento são <b>negociáveis</b>: os dois se compram e vendem no
        <a data-cap="comunidade">Mercado da Comunidade</a>. Tirou uma <b>Lendária</b>? O chat Mundo
        inteiro fica sabendo.</p>

        <h4>Equipar</h4>
        <p>Clique na bicicleta em <b>Bolsa → Itens Raros</b>. Você pode ter <b>quantas quiser</b>, de
        qualquer raridade, mas só <b>uma fica equipada</b> — e só a equipada vale.</p>

        ${nota(`<b>As porcentagens não somam.</b> Uma ${NOME_RARIDADE.comum.pt}, uma
        ${NOME_RARIDADE.incomum.pt} e uma ${NOME_RARIDADE.lendaria.pt} na bolsa, com a
        ${NOME_RARIDADE.comum.pt} equipada, é andar a <b>+${pctBike(c, 0)}%</b> — não a
        +${pctBike(c, 0) + pctBike(c, 1) + pctBike(c, 4)}%. Equipe sempre a melhor que você tem.`, 'atencao')}

        <ul>
          <li><b>Trocar tem espera de ${N(minTrocaBike(c), c.lang)} minutos.</b> Equipar outra ou
          guardar a equipada trava a troca seguinte por esse tempo, e sair do jogo não zera a
          espera.</li>
          <li><b>Anunciar a equipada no Mercado</b> tira ela do seu pé na hora: você volta a andar a pé
          até equipar outra — mesmo tendo outra da mesma raridade na bolsa. Cancelar o anúncio a devolve
          já equipada.</li>
        </ul>

        <h4>Onde ela NÃO vale</h4>
        <p>A bicicleta só encurta a <b>caminhada</b>. Ela não muda dano, cooldown de golpe nem
        alcance, e não vale no <b>PvP</b>, no <b>Ginásio</b>, na <b>Guild</b> nem na arena do
        <b>Boss</b> — esses modos rodam em simuladores próprios, e lá todo mundo anda na mesma
        velocidade.</p>

        ${nota(`<b>Ela rende mais onde o spawn é espaçado.</b> Numa hunt apertada, com um selvagem
        colado no outro, o passo quase não aparece; na <b>Outland</b>, onde se anda muito entre um e
        outro, a bike vira mais abates por hora.`, 'dica')}`,
      en: `
        <p>The <b>bicycle</b> is the game's <b>mobility</b> progression. On a hunt, your pokémon spends
        a good part of the time <b>walking</b> from one wild pokémon to the next — and that walk is
        what it shortens. It works for the <b>pokémon</b> and for the <b>trainer</b>, on the hunt and
        in the Cerulean plaza.</p>

        <h4>The five bicycles</h4>
        <p>The rarity decides how much faster you go. "Time per step" is how long a step takes compared
        with walking (100%): on the Legendary, a step takes <b>half</b> as long.</p>
        ${tabelaDeBicicletas(c)}

        <h4>How to get one</h4>
        <p>Every kill in <b>Outland</b> can drop a <b>Bicycle Fragment</b>
        (${P(chanceFragBike(c), c.lang)} per kill, ~${N(Math.round(1 / chanceFragBike(c)), c.lang)}
        kills on average).${dicaOutlandTiers(c)} Loot Boost raises the chance too.</p>

        <p>With <b>${N(custoFragBike(c), c.lang)} fragments</b>, the <b>Craft Bicycle</b> bench at
        <b>Professor Oak</b>, in the Pokémon Center, builds a bicycle. The rarity is <b>rolled</b>,
        with the odds in the table above — the same as the <a data-cap="casa">House</a>.</p>

        <p>Every bicycle comes with a <b>server number</b> — the first one rolled is <b>#000001</b> —,
        and that number is how you equip and list it. The <b>Bike registry</b>, under the <b>House</b>
        button, shows every bike ever opened, who rolled each one and which are for sale.</p>

        <p>Bicycles and fragments are <b>tradeable</b>: both are bought and sold on the
        <a data-cap="comunidade">Community Market</a>. Got a <b>Legendary</b>? The whole World chat
        finds out.</p>

        <h4>Equipping</h4>
        <p>Click the bicycle in <b>Bag → Rare Items</b>. You can own <b>as many as you like</b>, of any
        rarity, but only <b>one is equipped</b> — and only the equipped one counts.</p>

        ${nota(`<b>The percentages do not stack.</b> A ${NOME_RARIDADE.comum.en}, an
        ${NOME_RARIDADE.incomum.en} and a ${NOME_RARIDADE.lendaria.en} in the bag, with the
        ${NOME_RARIDADE.comum.en} equipped, is riding at <b>+${pctBike(c, 0)}%</b> — not
        +${pctBike(c, 0) + pctBike(c, 1) + pctBike(c, 4)}%. Always equip the best one you have.`, 'atencao')}

        <ul>
          <li><b>Switching has a ${N(minTrocaBike(c), c.lang)}-minute wait.</b> Equipping another one or
          storing the equipped one locks the next switch for that long, and logging out does not reset
          the wait.</li>
          <li><b>Listing the equipped one on the Market</b> takes it off you right away: you are back on
          foot until you equip another — even with another of the same rarity in your bag. Cancelling
          the listing gives it back already equipped.</li>
        </ul>

        <h4>Where it does NOT count</h4>
        <p>The bicycle only shortens the <b>walk</b>. It does not change damage, move cooldown or range,
        and it does not count in <b>PvP</b>, <b>Gyms</b>, <b>Guild</b> or the <b>Boss</b> arena — those
        modes run on their own simulators, where everyone walks at the same speed.</p>

        ${nota(`<b>It pays off most where spawns are spread out.</b> On a tight hunt, with wild pokémon
        right next to each other, the step barely shows; in <b>Outland</b>, where you walk a lot between
        them, the bike turns into more kills per hour.`, 'dica')}`,
      es: `
        <p>La <b>bicicleta</b> es la progresión de <b>movilidad</b> del juego. En la caza, buena parte
        del tiempo tu pokémon está <b>caminando</b> de un salvaje al siguiente — y es ese camino el que
        ella acorta. Vale para el <b>pokémon</b> y para el <b>entrenador</b>, en la caza y en la plaza
        de Cerulean.</p>

        <h4>Las cinco bicicletas</h4>
        <p>La rareza decide cuánto acelera. "Tiempo de cada paso" es cuánto dura un paso comparado con
        ir a pie (100%): en la Legendaria, el paso dura la <b>mitad</b>.</p>
        ${tabelaDeBicicletas(c)}

        <h4>Cómo conseguir una</h4>
        <p>Cada derrota en <b>Outland</b> puede soltar un <b>Fragmento de Bicicleta</b>
        (${P(chanceFragBike(c), c.lang)} por derrota, ~${N(Math.round(1 / chanceFragBike(c)), c.lang)}
        kills de media).${dicaOutlandTiers(c)} El Loot Boost también sube la probabilidad.</p>

        <p>Con <b>${N(custoFragBike(c), c.lang)} fragmentos</b>, el banco <b>Fabricar Bicicleta</b> del
        <b>Profesor Oak</b>, en el Centro Pokémon, arma una bicicleta. La rareza se <b>sortea</b>, con
        las probabilidades de la tabla — las mismas de la <a data-cap="casa">Casa</a>.</p>

        <p>Cada bicicleta sale con un <b>número del servidor</b> — la primera es la <b>#000001</b> —, y
        por ese número se equipa y se anuncia. El <b>Registro de Bicis</b>, en el botón <b>Casa</b>,
        muestra todas las bicis abiertas, quién sacó cada una y cuáles están en venta.</p>

        <p>Bicicleta y fragmento son <b>negociables</b>: los dos se compran y venden en el
        <a data-cap="comunidade">Mercado de la Comunidad</a>. ¿Te salió una <b>Legendaria</b>? Todo el
        chat Mundo se entera.</p>

        <h4>Equipar</h4>
        <p>Haz clic en la bicicleta en <b>Mochila → Objetos raros</b>. Puedes tener <b>todas las que
        quieras</b>, de cualquier rareza, pero solo <b>una queda equipada</b> — y solo la equipada
        vale.</p>

        ${nota(`<b>Los porcentajes no se suman.</b> Una ${NOME_RARIDADE.comum.es}, una
        ${NOME_RARIDADE.incomum.es} y una ${NOME_RARIDADE.lendaria.es} en la mochila, con la
        ${NOME_RARIDADE.comum.es} equipada, es ir a <b>+${pctBike(c, 0)}%</b> — no a
        +${pctBike(c, 0) + pctBike(c, 1) + pctBike(c, 4)}%. Equipa siempre la mejor que tengas.`, 'atencao')}

        <ul>
          <li><b>Cambiar tiene una espera de ${N(minTrocaBike(c), c.lang)} minutos.</b> Equipar otra o
          guardar la equipada bloquea el cambio siguiente durante ese tiempo, y salir del juego no
          reinicia la espera.</li>
          <li><b>Anunciar la equipada en el Mercado</b> te la quita en el acto: vuelves a ir a pie hasta
          equipar otra — aunque tengas otra de la misma rareza en la mochila. Cancelar el anuncio te la
          devuelve ya equipada.</li>
        </ul>

        <h4>Dónde NO vale</h4>
        <p>La bicicleta solo acorta la <b>caminata</b>. No cambia daño, cooldown de golpe ni alcance, y
        no vale en <b>PvP</b>, <b>Gimnasio</b>, <b>Guild</b> ni en la arena del <b>Boss</b> — esos modos
        corren en simuladores propios, y ahí todos caminan a la misma velocidad.</p>

        ${nota(`<b>Rinde más donde el spawn está espaciado.</b> En una caza apretada, con un salvaje
        pegado al otro, el paso casi no se nota; en <b>Outland</b>, donde se camina mucho entre uno y
        otro, la bici se convierte en más derrotas por hora.`, 'dica')}`,
    }),
  },

  // ---------------------------------------------------- 14. Professor Carvalho
  {
    id: 'tm',
    titulo: { pt: 'TM Disks', en: 'TM Disks', es: 'Discos TM' },
    grupo: 'mundo',
    html: (c) => ({
      pt: `
        <p>TMs são melhorias <b>permanentes</b> no pokémon — desbloqueiam conteúdo avançado e mudam
        como ele luta. No <b>Centro Pokémon</b>, fale com o <b>Professor Carvalho</b> (botão na
        praça). Lá tem um botão <b>[i]</b> com o guia completo.</p>

        ${nota(`O balcão do Professor tem <b>cinco bancadas</b>: as duas dos TMs (trocar peças e
        aplicar disco), <b>Fabricar Casa</b> (ver <a data-cap="casa">Casa e XP Share</a>),
        <b>Fabricar Bicicleta</b> (ver <a data-cap="bicicletas">Bicicletas</a>) e
        <b>Fabricar Shiny Stone</b> (ver <a data-cap="shiny">Shiny</a>).`)}

        <h4>Quando aplicado</h4>
        <ul>
          <li><b>Elemental</b> — o pokémon aprende um golpe especial novo (ex.: <b>TM Ghost</b>):
          power <b>${TM_ELEMENTAL_POWER}</b>, CD <b>${TM_ELEMENTAL_CD_MS / 1000} s</b>, área
          <b>${LADO_TM_ELEMENTAL}×${LADO_TM_ELEMENTAL}</b> com o centro no <b>alvo</b>. O tipo do
          disco tem que ser um dos tipos do pokémon.</li>
          <li><b>AoE</b> — os golpes do pokémon passam a acertar em área
          <b>${LADO_TM_AOE}×${LADO_TM_AOE}</b> com o centro no <b>seu pokémon</b>. Vários selvagens
          grudados levam dano <b>simultaneamente</b>.</li>
        </ul>
        <p>Elemental e AoE <b>coexistem</b> no mesmo bicho. Ex.: Gengar (Ghost/Poison) aceita disco
        <b>Ghost</b> ou <b>Poison</b> — um elemental por pokémon, mais um AoE se quiser. O AoE
        <b>não aumenta</b> o golpe do TM Elemental: ele continua no
        ${LADO_TM_ELEMENTAL}×${LADO_TM_ELEMENTAL} em volta do alvo.</p>

        <h4>Onde o golpe do TM Elemental acerta</h4>
        <p>O quadrado fica em volta do <b>alvo</b> (o selvagem com quem seu pokémon está brigando),
        e não em volta do seu pokémon: acerta o alvo e quem estiver encostado <b>nele</b>. Com vários
        selvagens cercando seu pokémon, quantos levam dano depende de onde o alvo está:</p>
        <ul>
          <li>Alvo <b>reto</b> (em cima, embaixo ou do lado): até <b>${TM_CERCO_RETO}</b> dos 8 que
          cercam seu pokémon, contando o alvo.</li>
          <li>Alvo na <b>diagonal</b>: até <b>${TM_CERCO_DIAGONAL}</b> — o alvo e os vizinhos dele.
          É o caso mais comum, porque seu pokémon para de andar assim que encosta no alvo, e
          encostar de quina já vale.</li>
        </ul>
        <p>Só o golpe <b>TM</b> acerta em área. Os outros golpes acertam um selvagem por vez, a não
        ser que o pokémon tenha o disco <b>AoE</b> — esse, sim, fica em volta do seu pokémon e pega
        todo mundo até ${(LADO_TM_AOE - 1) / 2} tiles de distância.</p>

        <h4>Bronze Boss Token → bosses → peças</h4>
        <p>Para farmar peças você precisa entrar nas arenas de boss (gasta
        <b>1× Bronze Boss Token</b> por tentativa):</p>
        <ul>
          <li><b>Token</b> — drop raro na <b>Outland</b> (${pctBossToken(c)} por kill, média
          ~${mediaBossToken(c)} derrotas).${dicaOutlandTiers(c, 'bosses')} Kanto e Orre não dropam. O NPC não vende, mas ele sai
          como prêmio das <a data-cap="caixas">Caixas do Market</a>.</li>
          <li><b>Bosses</b> — cada boss solta <b>um</b> dos dois tipos de peça: <b>TM Disk
          Piece</b> em ${origemDaPeca(c, idPecaElemental(c))} e <b>AoE TM Disk Piece</b> em
          ${origemDaPeca(c, idPecaAoe(c))}. Quanto mais alto o boss, maior a chance — a lista
          completa está em <a data-cap="bosses">Bosses</a>.</li>
        </ul>

        <h4>Peças → discos</h4>
        <p>Junte <b>${pecasPorDisco(c)}</b> peças iguais e troque no Professor (consumidas na hora):</p>
        ${tabela(
          ['Peça', 'Vem de', 'Vira'],
          `<tr><td>TM Disk Piece</td><td>${origemDaPeca(c, idPecaElemental(c))}</td><td>Disco elemental (escolhe o tipo)</td></tr>
           <tr><td>AoE TM Disk Piece</td><td>${origemDaPeca(c, idPecaAoe(c))}</td><td>Disco AoE</td></tr>`,
        )}
        <p>O disco vai para a bolsa; na aba <b>Aplicar</b> você escolhe um pokémon da equipe e
        consome o disco — é permanente no bicho.</p>

        <h4>Status aprimorados e Orre</h4>
        <p>Selvagens na <b>Outland</b> (treinador Nv 150+) e na <b>Orre</b> (as abas de Hoenn em diante, Nv 500+) têm stats
        mais altos que Kanto — mais HP e dano por golpe. Na <b>Orre</b>, o pokémon ativo precisa
        dos <b>dois</b> TMs (elemental + AoE) para caçar com eficiência.</p>

        ${nota(`Tokens e discos TM são escassos de propósito — a progressão passa por farm na
        Outland e vitórias em boss.`, 'dica')}`,
      en: `
        <p>TMs are <b>permanent</b> upgrades on a pokémon — they unlock advanced content and change
        how it fights. At the <b>Pokémon Center</b>, talk to <b>Professor Oak</b> (button in the
        square). There is an <b>[i]</b> button with the full guide.</p>

        ${nota(`The Professor's counter has <b>five benches</b>: the two TM ones (trade pieces and
        apply disk), <b>Craft House</b> (see <a data-cap="casa">House &amp; XP Share</a>),
        <b>Craft Bicycle</b> (see <a data-cap="bicicletas">Bicycles</a>) and
        <b>Craft Shiny Stone</b> (see <a data-cap="shiny">Shiny</a>).`)}

        <h4>When applied</h4>
        <ul>
          <li><b>Elemental</b> — the pokémon learns a new special move (e.g. <b>TM Ghost</b>): power
          <b>${TM_ELEMENTAL_POWER}</b>, <b>${TM_ELEMENTAL_CD_MS / 1000} s</b> CD,
          <b>${LADO_TM_ELEMENTAL}×${LADO_TM_ELEMENTAL}</b> area centered on the <b>target</b>. The
          disk type must match one of the pokémon's types.</li>
          <li><b>AoE</b> — the pokémon's moves hit an <b>${LADO_TM_AOE}×${LADO_TM_AOE}</b> area
          centered on <b>your pokémon</b>. Several nearby wilds take damage <b>at the same
          time</b>.</li>
        </ul>
        <p>Elemental and AoE <b>stack</b> on the same pokémon. E.g. Gengar (Ghost/Poison) accepts
        <b>Ghost</b> or <b>Poison</b> — one elemental per pokémon, plus AoE if you want. AoE
        <b>does not widen</b> the Elemental TM move: it stays a
        ${LADO_TM_ELEMENTAL}×${LADO_TM_ELEMENTAL} around the target.</p>

        <h4>Where the Elemental TM move hits</h4>
        <p>The square is around the <b>target</b> (the wild your pokémon is fighting), not around
        your pokémon: it hits the target and whoever is touching <b>it</b>. With several wilds
        surrounding your pokémon, how many take damage depends on where the target stands:</p>
        <ul>
          <li>Target <b>straight</b> (above, below or beside): up to <b>${TM_CERCO_RETO}</b> of the 8
          around your pokémon, counting the target.</li>
          <li>Target <b>diagonal</b>: up to <b>${TM_CERCO_DIAGONAL}</b> — the target and its
          neighbors. This is the most common case, because your pokémon stops walking as soon as it
          touches the target, and touching at a corner counts.</li>
        </ul>
        <p>Only the <b>TM</b> move hits an area. The other moves hit one wild at a time, unless the
        pokémon has the <b>AoE</b> disk — that one is centered on your pokémon and hits everyone up
        to ${(LADO_TM_AOE - 1) / 2} tiles away.</p>

        <h4>Bronze Boss Token → bosses → pieces</h4>
        <p>To farm pieces you enter boss arenas (costs <b>1× Bronze Boss Token</b> per attempt):</p>
        <ul>
          <li><b>Token</b> — rare <b>Outland</b> drop (${pctBossToken(c)} per kill, ~${mediaBossToken(c)}
          defeats on average).${dicaOutlandTiers(c, 'bosses')} Kanto and Orre do not drop it. The NPC does not sell it, but it
          comes out as a prize from the <a data-cap="caixas">Market Boxes</a>.</li>
          <li><b>Bosses</b> — each boss drops <b>one</b> of the two piece types: <b>TM Disk
          Piece</b> from ${origemDaPeca(c, idPecaElemental(c))} and <b>AoE TM Disk Piece</b> from
          ${origemDaPeca(c, idPecaAoe(c))}. The higher the boss, the higher the chance — the full
          list is under <a data-cap="bosses">Bosses</a>.</li>
        </ul>

        <h4>Pieces → disks</h4>
        <p>Collect <b>${pecasPorDisco(c)}</b> matching pieces and trade them at the Professor (consumed immediately):</p>
        ${tabela(
          ['Piece', 'From', 'Becomes'],
          `<tr><td>TM Disk Piece</td><td>${origemDaPeca(c, idPecaElemental(c))}</td><td>Elemental disk (pick type)</td></tr>
           <tr><td>AoE TM Disk Piece</td><td>${origemDaPeca(c, idPecaAoe(c))}</td><td>AoE disk</td></tr>`,
        )}
        <p>The disk goes to your bag; on the <b>Apply</b> tab you pick a team pokémon and consume
        the disk — it is permanent on that pokémon.</p>

        <h4>Enhanced stats and Orre</h4>
        <p>Wilds in <b>Outland</b> (trainer Lv 150+) and <b>Orre</b> (the Hoenn tab onward, Lv 500+) have higher stats
        than Kanto — more HP and damage per hit. In <b>Orre</b>, your active pokémon needs
        <b>both</b> TMs (elemental + AoE) to hunt efficiently.</p>`,
      es: `
        <p>Los TMs son mejoras <b>permanentes</b> en el pokémon — desbloquean contenido avanzado y
        cambian cómo pelea. En el <b>Centro Pokémon</b>, habla con el <b>Profesor Oak</b>. Hay un
        botón <b>[i]</b> con la guía completa.</p>

        ${nota(`El mostrador del Profesor tiene <b>cinco bancos</b>: los dos de TM (cambiar piezas
        y aplicar disco), <b>Fabricar Casa</b> (ver <a data-cap="casa">Casa y XP Share</a>),
        <b>Fabricar Bicicleta</b> (ver <a data-cap="bicicletas">Bicicletas</a>) y
        <b>Fabricar Shiny Stone</b> (ver <a data-cap="shiny">Shiny</a>).`)}

        <h4>Al aplicar</h4>
        <ul>
          <li><b>Elemental</b> — el pokémon aprende un golpe especial nuevo (ej.: <b>TM Ghost</b>):
          power <b>${TM_ELEMENTAL_POWER}</b>, CD <b>${TM_ELEMENTAL_CD_MS / 1000} s</b>, área
          <b>${LADO_TM_ELEMENTAL}×${LADO_TM_ELEMENTAL}</b> con el centro en el <b>objetivo</b>. El
          tipo del disco debe coincidir con uno de los tipos del pokémon.</li>
          <li><b>AoE</b> — los golpes del pokémon aciertan área <b>${LADO_TM_AOE}×${LADO_TM_AOE}</b>
          con el centro en <b>tu pokémon</b>. Varios salvajes juntos reciben daño
          <b>a la vez</b>.</li>
        </ul>
        <p>Elemental y AoE <b>conviven</b> en el mismo bicho. Ej.: Gengar (Ghost/Poison) acepta
        disco <b>Ghost</b> o <b>Poison</b> — un elemental por pokémon, más AoE si quieres. El AoE
        <b>no agranda</b> el golpe del TM Elemental: sigue en el
        ${LADO_TM_ELEMENTAL}×${LADO_TM_ELEMENTAL} alrededor del objetivo.</p>

        <h4>Dónde acierta el golpe del TM Elemental</h4>
        <p>El cuadrado está alrededor del <b>objetivo</b> (el salvaje con el que pelea tu pokémon),
        no alrededor de tu pokémon: acierta al objetivo y a quien esté pegado <b>a él</b>. Con
        varios salvajes rodeando a tu pokémon, cuántos reciben daño depende de dónde está el
        objetivo:</p>
        <ul>
          <li>Objetivo <b>recto</b> (arriba, abajo o al lado): hasta <b>${TM_CERCO_RETO}</b> de los 8
          que rodean a tu pokémon, contando el objetivo.</li>
          <li>Objetivo en <b>diagonal</b>: hasta <b>${TM_CERCO_DIAGONAL}</b> — el objetivo y sus
          vecinos. Es el caso más común, porque tu pokémon deja de caminar en cuanto toca al
          objetivo, y tocarlo en esquina ya cuenta.</li>
        </ul>
        <p>Solo el golpe <b>TM</b> acierta en área. Los demás golpes aciertan a un salvaje por vez,
        salvo que el pokémon tenga el disco <b>AoE</b> — ese sí está centrado en tu pokémon y
        alcanza a todos hasta ${(LADO_TM_AOE - 1) / 2} tiles de distancia.</p>

        <h4>Bronze Boss Token → jefes → piezas</h4>
        <p>Para farmear piezas entras en arenas de jefe (gastas <b>1× Bronze Boss Token</b> por
        intento):</p>
        <ul>
          <li><b>Token</b> — drop raro en <b>Outland</b> (${pctBossToken(c)} por kill, media
          ~${mediaBossToken(c)} derrotas).${dicaOutlandTiers(c, 'bosses')} Kanto y Orre no sueltan. El NPC no lo vende, pero sale
          como premio de las <a data-cap="caixas">Cajas del Market</a>.</li>
          <li><b>Bosses</b> — cada boss suelta <b>uno</b> de los dos tipos de pieza: <b>TM Disk
          Piece</b> en ${origemDaPeca(c, idPecaElemental(c))} y <b>AoE TM Disk Piece</b> en
          ${origemDaPeca(c, idPecaAoe(c))}. Cuanto más alto el boss, mayor la chance — la lista
          completa está en <a data-cap="bosses">Bosses</a>.</li>
        </ul>

        <h4>Piezas → discos</h4>
        <p>Junta <b>${pecasPorDisco(c)}</b> piezas iguales y cámbialas con el Profesor:</p>
        ${tabela(
          ['Pieza', 'De', 'Se convierte en'],
          `<tr><td>TM Disk Piece</td><td>${origemDaPeca(c, idPecaElemental(c))}</td><td>Disco elemental</td></tr>
           <tr><td>AoE TM Disk Piece</td><td>${origemDaPeca(c, idPecaAoe(c))}</td><td>Disco AoE</td></tr>`,
        )}
        <p>El disco va a la bolsa; en la pestaña <b>Aplicar</b> eliges un pokémon del equipo y
        consumes el disco — es permanente en el bicho.</p>

        <h4>Stats mejorados y Orre</h4>
        <p>Salvajes en <b>Outland</b> (entrenador Nv 150+) y <b>Orre</b> (de la pestaña Hoenn en adelante, Nv 500+) tienen stats más
        altos que Kanto. En <b>Orre</b>, el pokémon activo necesita los <b>dos</b> TMs (elemental +
        AoE) para cazar con eficiencia.</p>`,
    }),
  },

  // ------------------------------------------------------------- 15. bosses
  {
    id: 'bosses',
    titulo: { pt: 'Bosses', en: 'Bosses', es: 'Bosses' },
    grupo: 'mundo',
    html: (c) => ({
      pt: `
        <p>Arenas de desafio: você gasta um <b>Bronze Boss Token</b>, entra num mapa próprio e
        enfrenta um pokémon gigante. Ele fica parado — não persegue — e bate MUITO forte. Para
        desafiar, o seu <b>treinador</b> precisa ter pelo menos o <b>nível do boss</b> (coluna
        Nível da tabela abaixo).</p>

        <h4>Como conseguir o token</h4>
        <p><b>Drop na Outland</b> — todo selvagem derrotado na Outland pode soltar 1× Bronze Boss
        Token. A chance depende da Outland que você escolhe no seletor da aba <b>Outland</b> do
        Mapa: na Outland 1 é <b>${pctBossToken(c)}</b> (média ~${mediaBossToken(c)} kills), e as de
        cima multiplicam até <b>×${maiorMultOutland(c)}</b>. O Loot Boost aumenta por cima de
        qualquer linha.</p>
        ${tabelaBossTokenPorOutland(c)}
        <ul>
          <li><b>Não</b> vende no Market do NPC. Além do drop na Outland, ele sai como prêmio das
          <a data-cap="caixas">Caixas do Market</a> e se negocia entre jogadores.</li>
          <li>O NPC <b>não compra</b> o token (nem na venda avulsa nem no “vender tudo”). Quem
          define o preço é a comunidade no <a data-cap="comunidade">Mercado da Comunidade</a>.</li>
        </ul>
        ${tabelaDeBosses(c)}

        <h4>A penalidade de equipe</h4>
        <p>É a mecânica central da arena, e ela multiplica <b>o dano que o boss causa</b> — não o
        que ele aguenta.</p>
        <pre class="wk-formula">força    = Σ mín(1, nível do pokémon / nível de equipe do boss)
déficit  = máx(0, ${equipeIdealBoss(c)} − força)
multiplicador = ${BASE_PENALIDADE_BOSS} ^ déficit</pre>
        ${tabelaPenalidadeBoss(c)}
        ${nota(`Leve <b>${equipeIdealBoss(c)}</b> pokémon (ou mais) no nível do boss. Não é conselho —
        é a diferença entre tomar ${N(400, c.lang)} de dano e tomar até
        ${N(400 * multPenalidadeBoss(c, 0), c.lang)}.`, 'aviso')}

        <h4>O que muda lá dentro</h4>
        <ul>
          <li>O boss usa <b>golpes próprios</b>, com power e cooldown da ficha dele — não os da
          espécie.</li>
          <li>Ele <b>não</b> leva o ×${c.d.multDanoSelvagem ?? 1.8} de dano do selvagem: os golpes
          dele já vêm com power de boss.</li>
          <li>Todo boss é <b>neutro</b>: a tabela de tipos não vale contra ele nem a favor dele —
          nada é super-efetivo nem resistido, nos dois sentidos.</li>
          <li>Não dá para capturar um boss. O prêmio é a tabela de drops.</li>
        </ul>

        <h4>Se você vencer</h4>
        <p>Abre um painel com XP, boss points e loot; você volta ao <b>Centro Pokémon</b> (não
        retorna à hunt anterior). Curar e seguir caçando é escolher outra área no Mapa.</p>

        <h4>Se você perder</h4>
        <p>Você sai da arena e vai para o Centro Pokémon. <b>A entrada não volta</b> — nem se você
        abandonar por vontade própria.</p>`,
      en: `
        <p>Challenge arenas: you spend a <b>Bronze Boss Token</b>, enter a dedicated map and face
        a giant pokémon. It stands still — it does not chase — and it hits VERY hard. To
        challenge one, your <b>trainer</b> must be at least at the <b>boss's level</b> (the Level
        column in the table below).</p>

        <h4>Getting the token</h4>
        <p><b>Outland drop</b> — every wild defeated in Outland can drop 1× Bronze Boss Token. The
        chance depends on the Outland you pick in the selector on the Map's <b>Outland</b> tab: in
        Outland 1 it is <b>${pctBossToken(c)}</b> (~${mediaBossToken(c)} kills on average), and the
        higher ones multiply it up to <b>×${maiorMultOutland(c)}</b>. Loot Boost raises any row
        further.</p>
        ${tabelaBossTokenPorOutland(c)}
        <ul>
          <li><b>Not</b> sold at the NPC Market. Besides the Outland drop, it comes out as a prize
          from the <a data-cap="caixas">Market Boxes</a> and is traded between players.</li>
          <li>The NPC does <b>not buy</b> the token (single sell or sell-all). Price is set by
          players on the <a data-cap="comunidade">Community Market</a>.</li>
        </ul>
        ${tabelaDeBosses(c)}

        <h4>The team penalty</h4>
        <p>This is the arena's core mechanic, and it multiplies <b>the damage the boss deals</b> —
        not the damage it takes.</p>
        <pre class="wk-formula">strength = Σ min(1, pokémon level / boss team level)
deficit  = max(0, ${equipeIdealBoss(c)} − strength)
multiplier = ${BASE_PENALIDADE_BOSS} ^ deficit</pre>
        ${tabelaPenalidadeBoss(c)}
        ${nota(`Bring <b>${equipeIdealBoss(c)}</b> pokémon (or more) at the boss's level. This is not
        advice — it is the difference between taking ${N(400, c.lang)} damage and taking up to
        ${N(400 * multPenalidadeBoss(c, 0), c.lang)}.`, 'aviso')}

        <h4>What changes inside</h4>
        <ul>
          <li>The boss uses <b>its own moves</b>, with the power and cooldown from its sheet — not
          the species'.</li>
          <li>It does <b>not</b> take the ×${c.d.multDanoSelvagem ?? 1.8} wild damage multiplier:
          its moves already come with boss-grade power.</li>
          <li>Every boss is <b>neutral</b>: the type chart does not apply against it or for it —
          nothing is super effective or resisted, either way.</li>
          <li>You cannot catch a boss. The prize is the drop table.</li>
        </ul>

        <h4>If you win</h4>
        <p>A loot panel shows XP, boss points and drops; you return to the <b>Pokémon Center</b>
        (not the previous hunt).</p>

        <h4>If you lose</h4>
        <p>You leave the arena and go to the Pokémon Center. <b>The entry fee is not refunded</b> —
        not even if you leave voluntarily.</p>`,
      es: `
        <p>Arenas de desafío: gastas un <b>Bronze Boss Token</b>, entras en un mapa propio y te
        enfrentas a un pokémon gigante. Se queda quieto — no persigue — y pega MUY fuerte. Para
        desafiarlo, tu <b>entrenador</b> necesita al menos el <b>nivel del boss</b> (columna Nivel
        de la tabla de abajo).</p>

        <h4>Cómo conseguir el token</h4>
        <p><b>Drop en Outland</b> — todo salvaje derrotado en Outland puede soltar 1× Bronze Boss
        Token. La probabilidad depende de la Outland que eliges en el selector de la pestaña
        <b>Outland</b> del Mapa: en Outland 1 es <b>${pctBossToken(c)}</b> (~${mediaBossToken(c)}
        kills de media), y las de arriba la multiplican hasta <b>×${maiorMultOutland(c)}</b>. El
        Loot Boost la sube aún más en cualquier fila.</p>
        ${tabelaBossTokenPorOutland(c)}
        <ul>
          <li><b>No</b> se vende en el Market del NPC. Además del drop en Outland, sale como premio
          de las <a data-cap="caixas">Cajas del Market</a> y se negocia entre jugadores.</li>
          <li>El NPC <b>no compra</b> el token. El precio lo fija la comunidad en el
          <a data-cap="comunidade">Mercado de la Comunidad</a>.</li>
        </ul>
        ${tabelaDeBosses(c)}

        <h4>La penalización de equipo</h4>
        <p>Es la mecánica central de la arena, y multiplica <b>el daño que hace el boss</b> — no el
        que aguanta.</p>
        <pre class="wk-formula">fuerza   = Σ mín(1, nivel del pokémon / nivel de equipo del boss)
déficit  = máx(0, ${equipeIdealBoss(c)} − fuerza)
multiplicador = ${BASE_PENALIDADE_BOSS} ^ déficit</pre>
        ${tabelaPenalidadeBoss(c)}
        ${nota(`Lleva <b>${equipeIdealBoss(c)}</b> pokémon (o más) al nivel del boss. No es un consejo
        — es la diferencia entre recibir ${N(400, c.lang)} de daño y recibir hasta
        ${N(400 * multPenalidadeBoss(c, 0), c.lang)}.`, 'aviso')}

        <h4>Qué cambia allí dentro</h4>
        <ul>
          <li>El boss usa <b>movimientos propios</b>, con el power y el cooldown de su ficha — no
          los de la especie.</li>
          <li><b>No</b> recibe el ×${c.d.multDanoSelvagem ?? 1.8} de daño del salvaje: sus
          movimientos ya vienen con power de boss.</li>
          <li>Todo boss es <b>neutro</b>: la tabla de tipos no vale contra él ni a su favor — nada
          es supereficaz ni resistido, en ninguno de los dos sentidos.</li>
          <li>No se puede capturar a un boss. El premio es la tabla de drops.</li>
        </ul>

        <h4>Si ganas</h4>
        <p>Aparece un panel con XP, boss points y loot; vuelves al <b>Centro Pokémon</b>.</p>

        <h4>Si pierdes</h4>
        <p>Sales de la arena y vas al Centro Pokémon. <b>La entrada no se devuelve</b> — ni siquiera
        si abandonas por voluntad propia.</p>`,
    }),
  },

  // ------------------------------------------------------------ 12b. mega evolução
  //
  // Depois de Bosses, e não junto de Evolução: o que o jogador precisa entender primeiro é
  // ONDE o fragmento cai, e isso é o capítulo de cima. A evolução por pedra de tipo e a mega
  // são duas moedas diferentes para dois destinos diferentes, e misturá-las num capítulo só
  // faria o leitor achar que uma Water Stone tem algo a ver com a Gyaradosite.
  {
    id: 'mega',
    titulo: { pt: 'Mega Evolução', en: 'Mega Evolution', es: 'Mega Evolución' },
    grupo: 'mundo',
    html: (c) => {
      const n = MEGAS.length;
      const semShiny = MEGAS.filter((m) => !megaTemShiny(m)).length;
      const custo = c.d.mega?.custo ?? 10;
      const base = pctMega(c.d.mega?.chanceBase ?? 0.005);
      const baseShiny = pctMega(c.d.mega?.chanceBaseShiny ?? 0.0025);
      const lista = MEGAS.map((m) => m.nome.replace(/^Mega /, '')).join(', ');
      return {
        pt: `
        <p>A <b>Mega Evolução</b> troca o seu pokémon pela <b>forma Mega</b> dele: arte nova,
        <b>stats-base novos</b> e, em muitas, <b>tipos novos</b>. São <b>${n}</b> megas no jogo, e
        elas entram na Pokédex numa aba própria — a aba <b>Mega</b>, na faixa <b>#3000</b>
        (Mega Gengar é o <b>#3094</b>, que é <code>3000 + 94</code>, o dex do Gengar).</p>

        ${nota(`Não é bônus de porcentagem. As seis bases são <b>substituídas</b> pelas da
        Pokédex oficial: Mega Alakazam tem <b>175</b> de Sp. Atk contra 135, e Mega Aggron troca
        Sp. Atk por <b>230</b> de Defense. O seu <a data-cap="stats">refino</a>, o IV, a
        qualidade e a potência continuam valendo <b>por cima</b> disso.`, 'dica')}

        <h4>Um terceiro golpe de 600, na METADE da recarga</h4>
        <p>A mega herda o <b>mesmo moveset</b> da espécie base — cópia exata, nada sai — e ganha
        <b>um golpe a mais</b>: 600 de poder, do <b>tipo primário dela</b> (logo, sempre com STAB)
        e com <b>30 s</b> de recarga. Como toda última evolução já tem dois golpes de 600, a mega
        fica com <b>três</b>.</p>
        ${nota(`Os 30 s são a única coisa do catálogo que sai da curva de cooldown de propósito
        — todo outro golpe de 600 recarrega em 60 s. É o que a mega de fato entrega: o golpe
        dispara <b>duas vezes</b> no tempo em que os outros dois disparam uma. O gargalo de um
        pokémon de endgame é a recarga, não a falta de opção.`, 'dica')}

        <h4>O caminho, em quatro passos</h4>
        <ol>
          <li><b>Derrote bosses.</b> Todo boss lendário solta <b>Fragmento de Mega Stone</b> e
          <b>Fragmento de Mega Shiny Stone</b>, além da peça de TM de sempre (ver
          <a data-cap="bosses">Bosses</a>).</li>
          <li><b>Junte ${custo}.</b> Os fragmentos também se compram no
          <a data-cap="comunidade">Mercado da Comunidade</a>.</li>
          <li><b>Professor Carvalho, bancada Mega.</b> Os ${custo} fragmentos viram a
          <b>Mega Stone da espécie que VOCÊ escolher</b> — não há sorteio.</li>
          <li><b>Mega Evoluir.</b> Com a pedra na bolsa, o botão dourado aparece no pokémon.</li>
        </ol>

        <h4>A chance no boss sobe com o degrau</h4>
        <p>É a <b>mesma escada</b> da peça de TM: <b>${base}</b> no primeiro par de bosses
        (Nv 300), o <b>dobro</b> no segundo (Nv 650) e mais um degrau a cada par. O fragmento
        <b>shiny</b> é sempre a <b>metade</b> do comum — <b>${baseShiny}</b> no Nv 300.</p>
        ${tabela(
          ['Par de bosses', 'Fragmento de Mega', 'Fragmento de Mega Shiny'],
          [0, 1, 2, 3].map((par) => `<tr>
            <td><b>${par === 0 ? 'Nv 300' : par === 1 ? 'Nv 650' : `${par + 1}º par`}</b></td>
            <td>${pctMega(0.005 * (par + 1))}</td>
            <td>${pctMega(0.0025 * (par + 1))}</td>
          </tr>`).join(''),
        )}
        ${nota(`A chance da ficha de cada boss está na aba <b>Boss</b>, no bloco
        <b>Recompensas</b> — ela é por vitória, e cresce par a par até o último boss da lista.`)}

        <h4>Shiny pede pedra shiny</h4>
        <p>Um pokémon <b>shiny</b> só megaevolui com a <b>Shiny Mega Stone</b>, e <b>continua
        shiny</b> depois. A pedra comum <b>recusa</b> shiny — de propósito: sem essa trava, o
        item mais raro da conta viraria uma mega de cor comum, e não há como desfazer.</p>
        ${semShiny === 0
          ? nota(`<b>As ${n} têm forma shiny</b> — nenhuma fica de fora. Se um dia uma mega nova
          chegar só com a arte comum, ela entra sem Shiny Stone no catálogo e a bancada não a
          oferece: uma pedra que não dá para usar seria pior do que uma pedra que não existe.`)
          : nota(`<b>${semShiny === 1 ? 'Uma mega ainda não tem arte shiny' : `${semShiny} megas ainda não têm arte shiny`}.</b>
          Enquanto a arte não entra, a Shiny Stone dela não existe no catálogo e um shiny daquela
          espécie não megaevolui. Uma pedra que não dá para usar seria pior do que uma pedra que
          não existe.`, 'aviso')}

        <h4>O que muda, e o que não muda</h4>
        <ul>
          <li><b>Os tipos podem mudar.</b> Mega Gyarados vira WATER/DARK, Mega Ampharos ganha
          DRAGON, Mega Sceptile ganha DRAGON. Isso mexe no STAB, na
          <a data-cap="tipos">efetividade</a> e até na pedra de <a data-cap="stats">refino</a>.</li>
          <li><b>Não tem volta</b>, como toda evolução aqui — e por isso megaevoluir
          <b>tranca o pokémon na venda</b> (destravar é um clique).</li>
          <li><b>A nota nunca cai.</b> Megaevoluir sempre <b>sobe</b> o N=, pela mesma regra que
          vale para evoluir (ver <a data-cap="nota">A nota</a>).</li>
          <li>Uma mega <b>não evolui de novo</b>, e variantes de <b>Outland não megaevoluem</b>.
          Os clones de Orre megaevoluem normalmente — são a mesma espécie.</li>
          <li>Mega <b>não aparece em hunt</b> e <b>não se captura</b>: ela só existe fabricada.</li>
        </ul>

        <h4>Tudo isso se negocia</h4>
        <p>Os <b>dois fragmentos</b> vão para a aba <b>Fragmentos</b> do Mercado da Comunidade, e
        as <b>${n * 2 - semShiny} pedras</b> (comuns e shiny) têm aba própria: <b>Mega Stones</b>.
        Nenhuma delas vende ao NPC — quem define o preço é a comunidade.</p>

        <h4>As ${n} megas</h4>
        <p>${lista}.</p>`,

        en: `
        <p><b>Mega Evolution</b> swaps your pokémon for its <b>Mega form</b>: new art, <b>new base
        stats</b> and, in many of them, <b>new types</b>. There are <b>${n}</b> megas in the game,
        and they join the Pokédex in a tab of their own — the <b>Mega</b> tab, in the
        <b>#3000</b> range (Mega Gengar is <b>#3094</b>, which is <code>3000 + 94</code>,
        Gengar's dex).</p>

        ${nota(`This is not a percentage bonus. The six base stats are <b>replaced</b> by the
        official Pokédex ones: Mega Alakazam has <b>175</b> Sp. Atk against 135, and Mega Aggron
        trades Sp. Atk for <b>230</b> Defense. Your <a data-cap="stats">refine</a>, IV, quality
        and potency still stack <b>on top</b> of that.`, 'dica')}

        <h4>A third 600 move, at HALF the cooldown</h4>
        <p>A mega inherits the <b>same moveset</b> as the base species — an exact copy, nothing
        is dropped — and gains <b>one extra move</b>: 600 power, of <b>its own primary type</b>
        (so always with STAB) and with a <b>30 s</b> cooldown. Since every final evolution
        already has two 600 moves, a mega ends up with <b>three</b>.</p>
        ${nota(`Those 30 s are the only thing in the catalogue that leaves the cooldown curve on
        purpose — every other 600 move recharges in 60 s. It is what the mega actually delivers:
        the move fires <b>twice</b> in the time the other two fire once. The bottleneck for an
        endgame pokémon is the cooldown, not the lack of options.`, 'dica')}

        <h4>The path, in four steps</h4>
        <ol>
          <li><b>Beat bosses.</b> Every legendary boss drops <b>Mega Stone Fragment</b> and
          <b>Mega Shiny Stone Fragment</b>, on top of the usual TM piece (see
          <a data-cap="bosses">Bosses</a>).</li>
          <li><b>Collect ${custo}.</b> Fragments are also buyable on the
          <a data-cap="comunidade">Community Market</a>.</li>
          <li><b>Professor Oak, Mega bench.</b> The ${custo} fragments become the
          <b>Mega Stone of the species YOU pick</b> — there is no lottery.</li>
          <li><b>Mega Evolve.</b> With the stone in your bag, the golden button shows up on the
          pokémon.</li>
        </ol>

        <h4>The boss drop rate climbs with the step</h4>
        <p>It is the <b>same ladder</b> as the TM piece: <b>${base}</b> on the first boss pair
        (Lv 300), <b>double</b> on the second (Lv 650) and one more step per pair. The
        <b>shiny</b> fragment is always <b>half</b> of the normal one — <b>${baseShiny}</b> at
        Lv 300.</p>
        ${tabela(
          ['Boss pair', 'Mega Fragment', 'Mega Shiny Fragment'],
          [0, 1, 2, 3].map((par) => `<tr>
            <td><b>${par === 0 ? 'Lv 300' : par === 1 ? 'Lv 650' : `pair #${par + 1}`}</b></td>
            <td>${pctMega(0.005 * (par + 1))}</td>
            <td>${pctMega(0.0025 * (par + 1))}</td>
          </tr>`).join(''),
        )}
        ${nota(`Each boss's own rate is on the <b>Boss</b> tab, in the <b>Rewards</b> block — it
        is per win, and it grows pair by pair up to the last boss on the list.`)}

        <h4>Shiny needs the shiny stone</h4>
        <p>A <b>shiny</b> pokémon only mega evolves with the <b>Shiny Mega Stone</b>, and it
        <b>stays shiny</b> afterwards. The normal stone <b>refuses</b> shiny on purpose: without
        that lock, the rarest item on the account would turn into a normal-coloured mega, and
        there is no undo.</p>
        ${semShiny === 0
          ? nota(`<b>All ${n} have a shiny form</b> — none is left out. If a new mega ever arrives
          with only the normal art, it joins with no Shiny Stone in the catalogue and the bench
          does not offer one: a stone you cannot use would be worse than a stone that does not
          exist.`)
          : nota(`<b>${semShiny === 1 ? 'One mega has no shiny art yet' : `${semShiny} megas have no shiny art yet`}.</b>
          Until the art lands, its Shiny Stone does not exist in the catalogue and a shiny of
          that species cannot mega evolve. A stone you cannot use would be worse than a stone
          that does not exist.`, 'aviso')}

        <h4>What changes, and what does not</h4>
        <ul>
          <li><b>Typing can change.</b> Mega Gyarados turns WATER/DARK, Mega Ampharos gains
          DRAGON, Mega Sceptile gains DRAGON. That changes STAB,
          <a data-cap="tipos">effectiveness</a> and even the <a data-cap="stats">refine</a>
          stone.</li>
          <li><b>There is no going back</b>, like every evolution here — which is why mega
          evolving <b>locks the pokémon from selling</b> (one click unlocks it).</li>
          <li><b>The grade never drops.</b> Mega evolving always <b>raises</b> the N=, by the
          same rule that applies to evolving (see <a data-cap="nota">The grade</a>).</li>
          <li>A mega <b>does not evolve again</b>, and <b>Outland variants do not mega
          evolve</b>. Orre clones do — they are the same species.</li>
          <li>Megas <b>appear in no hunt</b> and <b>cannot be caught</b>: they only exist
          crafted.</li>
        </ul>

        <h4>All of it is tradeable</h4>
        <p>The <b>two fragments</b> go to the <b>Fragments</b> tab of the Community Market, and
        the <b>${n * 2 - semShiny} stones</b> (normal and shiny) have a tab of their own:
        <b>Mega Stones</b>. None of them sells to the NPC — the community sets the price.</p>

        <h4>The ${n} megas</h4>
        <p>${lista}.</p>`,

        es: `
        <p>La <b>Mega Evolución</b> cambia tu pokémon por su <b>forma Mega</b>: arte nuevo,
        <b>stats base nuevos</b> y, en muchas, <b>tipos nuevos</b>. Son <b>${n}</b> megas en el
        juego, y entran en la Pokédex en una pestaña propia — la pestaña <b>Mega</b>, en el rango
        <b>#3000</b> (Mega Gengar es el <b>#3094</b>, o sea <code>3000 + 94</code>, el dex del
        Gengar).</p>

        ${nota(`No es un bono porcentual. Las seis bases se <b>sustituyen</b> por las de la
        Pokédex oficial: Mega Alakazam tiene <b>175</b> de Sp. Atk contra 135, y Mega Aggron
        cambia Sp. Atk por <b>230</b> de Defense. Tu <a data-cap="stats">refinado</a>, el IV, la
        calidad y la potencia siguen sumando <b>encima</b> de eso.`, 'dica')}

        <h4>Un tercer golpe de 600, a la MITAD de la recarga</h4>
        <p>La mega hereda el <b>mismo moveset</b> de la especie base — copia exacta, no se pierde
        nada — y gana <b>un golpe más</b>: 600 de poder, de <b>su tipo primario</b> (o sea,
        siempre con STAB) y con <b>30 s</b> de recarga. Como toda última evolución ya tiene dos
        golpes de 600, la mega queda con <b>tres</b>.</p>
        ${nota(`Esos 30 s son lo único del catálogo que sale de la curva de cooldown a propósito
        — todo otro golpe de 600 recarga en 60 s. Es lo que la mega entrega de verdad: el golpe
        dispara <b>dos veces</b> en el tiempo en que los otros dos disparan una. El cuello de
        botella de un pokémon de endgame es la recarga, no la falta de opciones.`, 'dica')}

        <h4>El camino, en cuatro pasos</h4>
        <ol>
          <li><b>Vence bosses.</b> Todo boss legendario suelta <b>Fragmento de Mega Stone</b> y
          <b>Fragmento de Mega Shiny Stone</b>, además de la pieza de TM de siempre (ver
          <a data-cap="bosses">Bosses</a>).</li>
          <li><b>Junta ${custo}.</b> Los fragmentos también se compran en el
          <a data-cap="comunidade">Mercado de la Comunidad</a>.</li>
          <li><b>Profesor Oak, banco Mega.</b> Los ${custo} fragmentos se convierten en la
          <b>Mega Stone de la especie que TÚ elijas</b> — no hay sorteo.</li>
          <li><b>Mega Evoluciona.</b> Con la piedra en la bolsa, el botón dorado aparece en el
          pokémon.</li>
        </ol>

        <h4>La probabilidad en el boss sube con el escalón</h4>
        <p>Es la <b>misma escalera</b> de la pieza de TM: <b>${base}</b> en el primer par de
        bosses (Nv 300), el <b>doble</b> en el segundo (Nv 650) y un escalón más por par. El
        fragmento <b>shiny</b> es siempre la <b>mitad</b> del normal — <b>${baseShiny}</b> en el
        Nv 300.</p>
        ${tabela(
          ['Par de bosses', 'Fragmento de Mega', 'Fragmento de Mega Shiny'],
          [0, 1, 2, 3].map((par) => `<tr>
            <td><b>${par === 0 ? 'Nv 300' : par === 1 ? 'Nv 650' : `${par + 1}º par`}</b></td>
            <td>${pctMega(0.005 * (par + 1))}</td>
            <td>${pctMega(0.0025 * (par + 1))}</td>
          </tr>`).join(''),
        )}
        ${nota(`La probabilidad de cada boss está en la pestaña <b>Boss</b>, en el bloque
        <b>Recompensas</b> — es por victoria, y crece par a par hasta el último boss de la
        lista.`)}

        <h4>Shiny pide piedra shiny</h4>
        <p>Un pokémon <b>shiny</b> solo mega evoluciona con la <b>Shiny Mega Stone</b>, y
        <b>sigue shiny</b> después. La piedra normal <b>rechaza</b> shiny a propósito: sin ese
        bloqueo, el ítem más raro de la cuenta se volvería una mega de color normal, y no hay
        vuelta atrás.</p>
        ${semShiny === 0
          ? nota(`<b>Las ${n} tienen forma shiny</b> — ninguna queda fuera. Si algún día llega una
          mega nueva solo con el arte normal, entra sin Shiny Stone en el catálogo y el banco no
          la ofrece: una piedra que no se puede usar sería peor que una piedra que no existe.`)
          : nota(`<b>${semShiny === 1 ? 'Una mega aún no tiene arte shiny' : `${semShiny} megas aún no tienen arte shiny`}.</b>
          Mientras el arte no llega, su Shiny Stone no existe en el catálogo y un shiny de esa
          especie no puede mega evolucionar. Una piedra que no se puede usar sería peor que una
          piedra que no existe.`, 'aviso')}

        <h4>Qué cambia y qué no</h4>
        <ul>
          <li><b>Los tipos pueden cambiar.</b> Mega Gyarados pasa a WATER/DARK, Mega Ampharos
          gana DRAGON, Mega Sceptile gana DRAGON. Eso afecta el STAB, la
          <a data-cap="tipos">efectividad</a> y hasta la piedra de
          <a data-cap="stats">refinado</a>.</li>
          <li><b>No tiene vuelta atrás</b>, como toda evolución aquí — por eso mega evolucionar
          <b>bloquea el pokémon para la venta</b> (se desbloquea con un clic).</li>
          <li><b>La nota nunca baja.</b> Mega evolucionar siempre <b>sube</b> el N=, por la misma
          regla que vale para evolucionar (ver <a data-cap="nota">La nota</a>).</li>
          <li>Una mega <b>no evoluciona de nuevo</b>, y las variantes de <b>Outland no mega
          evolucionan</b>. Los clones de Orre sí — son la misma especie.</li>
          <li>Las megas <b>no aparecen en hunt</b> y <b>no se capturan</b>: solo existen
          fabricadas.</li>
        </ul>

        <h4>Todo esto se negocia</h4>
        <p>Los <b>dos fragmentos</b> van a la pestaña <b>Fragmentos</b> del Mercado de la
        Comunidad, y las <b>${n * 2 - semShiny} piedras</b> (normales y shiny) tienen pestaña
        propia: <b>Mega Stones</b>. Ninguna se vende al NPC — el precio lo pone la comunidad.</p>

        <h4>Las ${n} megas</h4>
        <p>${lista}.</p>`,
      };
    },
  },

  // ---------------------------------------------------------------- 13. pvp
  {
    id: 'pvp',
    titulo: { pt: 'PvP Ranqueado', en: 'Ranked PvP', es: 'PvP Clasificatorio' },
    grupo: 'mundo',
    html: (c) => {
      const posic = N(PVP_PARTIDAS_POSICIONAMENTO, c.lang);
      const espera = Math.round(PVP_ENTRE_PARTIDAS_MS / 1000);
      const atrito = Math.round(PVP_ATRITO_DERROTA * 100);
      const teto = N(PVP_TETO_POSICIONAMENTO, c.lang);
      const elite = N(PVP_PR_ELITE, c.lang);
      const revancheMin = 10; // REVANCHE_MS, em `server/game/pvp-ranqueado.mjs`
      // O que cada faixa leva, escrito a partir da MESMA tabela com que o servidor paga
      // (`PVP_PREMIOS`): o prêmio mudou de dias para horas uma vez, e texto escrito à mão
      // teria ficado prometendo os sete dias da era mensal.
      const L = {
        pt: ['e', 'por', 'dias', 'horas'],
        en: ['and', 'for', 'days', 'hours'],
        es: ['y', 'por', 'días', 'horas'],
      }[c.lang] ?? ['e', 'por', 'dias', 'horas'];
      const nomeBoostPvp = {
        shiny: 'Shiny Secret Lure', captura: 'Capture Boost', xp: 'XP Boost',
        pokexp: c.lang === 'en' ? 'Pokémon XP Boost' : 'XP Boost Pokémon',
      };
      const duracaoPvp = (h) => (h % 24 === 0 ? `${N(h / 24, c.lang)} ${L[2]}` : `${N(h, c.lang)} ${L[3]}`);
      const premiosPvp = PVP_PREMIOS.map(({ horas }) => {
        const pares = Object.entries(horas);
        const mesma = pares.every(([, h]) => h === pares[0][1]);
        return mesma
          ? `<b>${pares.map(([k]) => nomeBoostPvp[k] ?? k).join(` ${L[0]} `)}</b> ${L[1]} ${duracaoPvp(pares[0][1])}`
          : pares.map(([k, h]) => `<b>${nomeBoostPvp[k] ?? k}</b> ${L[1]} ${duracaoPvp(h)}`).join(` ${L[0]} `);
      });
      return {
        pt: `
        <p><b>Um contra um, contra alguém do seu rank.</b> Você monta a equipe, entra na fila e
        a partida acontece <b>sozinha</b> — não há nada para clicar durante a luta. O que está
        em jogo é um número só: os <b>pontos de ranking (PR)</b>. Tier, divisão e a barrinha da
        tela saem todos dele.</p>

        <h4>Como funciona, em três passos</h4>
        <ol class="wk-passos">
          <li><b>Monte a equipe de PvP</b> — até <b>${N(PVP_TIME_MAX, c.lang)} pokémon</b>, na
          ordem em que entram. Ela é <b>separada da equipe de hunt</b>: mexer numa não mexe na
          outra. O primeiro abre a luta; os outros entram quando o anterior cai.</li>
          <li><b>Procure partida.</b> Pode fechar a tela e continuar caçando — a busca segue, e
          um aviso pequeno fica no alto ("Na fila PvP · 0:42") com um × para cancelar.</li>
          <li><b>A partida roda sozinha.</b> Abre um mapa, os dois times se enfrentam, e no fim
          a tela diz quanto de PR você ganhou ou perdeu.</li>
        </ol>

        <h4>As regras da casa</h4>
        ${tabela(
    [c.r.regra, c.r.valor],
    `<tr><td>Formato</td><td>1 contra 1, <b>100% automático</b></td></tr>
           <tr><td>Nível de treinador</td><td class="wk-num destaque">${N(PVP_NIVEL_MIN, c.lang)}</td></tr>
           <tr><td>Pokémon na equipe</td><td class="wk-num">${N(PVP_TIME_MIN, c.lang)} a ${N(PVP_TIME_MAX, c.lang)}</td></tr>
           <tr><td>Custo para entrar</td><td><b>nada</b> — sem ficha, sem ouro, sem taxa</td></tr>
           <tr><td>Perder custa XP?</td><td><b>não</b> — só PR</td></tr>
           <tr><td>Entre uma partida e a fila seguinte</td><td class="wk-num">${espera} s</td></tr>
           <tr><td>Reencontrar o mesmo oponente</td><td>evitado por ${revancheMin} min — e paga PR cheio</td></tr>`,
  )}

        <h4>Os sete ranks</h4>
        ${tabelaDeRanks(c)}
        <p>Dentro de cada tier a divisão vai de <b>I</b> a <b>III</b>, de
        ${N(PVP_PONTOS_POR_DIVISAO, c.lang)} em ${N(PVP_PONTOS_POR_DIVISAO, c.lang)} PR. <b>I é a
        entrada e III é o topo</b> — Ouro III é melhor que Ouro I. É o inverso do League of
        Legends, de propósito: lá a ordem invertida é herança de um sistema antigo.</p>

        ${nota(`<b>Mestre e Challenger são VAGAS, não pontos.</b> Passar dos ${elite} PR te põe
        na fila de espera: as <b>${N(PVP_VAGAS_CHALLENGER, c.lang)} primeiras</b> posições da
        tabela são Challenger e da ${N(PVP_VAGAS_CHALLENGER + 1, c.lang)}ª à
        <b>${N(PVP_VAGAS_MESTRE, c.lang)}ª</b> é Mestre. Enquanto não houver vaga você aparece
        como Diamante. Pontos inflam com o tempo; posição não — "estar entre os
        ${N(PVP_VAGAS_CHALLENGER, c.lang)} melhores do servidor" quer dizer a mesma coisa daqui
        a um ano.`)}

        <h4>Posicionamento: as ${posic} primeiras</h4>
        <p>Nas suas <b>${posic} primeiras partidas</b> você aparece como <b>Não classificado</b>,
        não entra na tabela, e o PR não passa de <b>${teto}</b> — o topo do Bronze. Todo mundo
        começa no pé da escada; a subida <b>é</b> o jogo.</p>

        <h4>Quanto vale cada partida</h4>
        <p>É o Elo do xadrez: o que decide é a <b>diferença de rank</b> entre os dois.</p>
        <ul>
          <li>Contra alguém do seu nível, o movimento é pequeno e parelho.</li>
          <li><b>Ganhar de quem está muito acima</b> paga muito — e custa muito a ele.</li>
          <li><b>Perder para quem está muito abaixo</b> é a derrota mais cara que existe.</li>
        </ul>
        <p>Com uma diferença que vale entender: <b>a derrota cobra ${atrito}% do que a vitória
        pagaria</b>. Não é soma zero, e é de propósito — com todo mundo começando do chão, uma
        escada de soma zero deixaria Diamante para cima <b>inalcançável</b>, porque não haveria
        de onde os pontos virem. Com o atrito, quem ganha cerca de metade sobe devagar e quem
        ganha menos de ~41% desce.</p>

        ${nota(`<b>Escudo de tier:</b> acabou de subir de tier? A primeira derrota no piso dele
        não te rebaixa. Cair de Ouro para Prata na derrota seguinte à promoção é a sensação ruim
        que o escudo existe para evitar.`)}

        <h4>Inatividade e temporada</h4>
        <ul>
          <li><b>${N(PVP_DECAIMENTO_HORAS, c.lang)} horas sem jogar</b> (um dia) derrubam Mestre e
          Challenger para o <b>Diamante</b>: os pontos caem para <b>um acima do primeiro
          Diamante</b> da tabela, e a vaga vai para quem está jogando. Para voltar, é subir de novo
          até os 1.500 PR. Enquanto você está na elite, um <b>relógio</b> no seu cartão mostra
          quanto falta — e toda partida ranqueada o zera.</li>
          <li><b>Toda segunda-feira, 00:00 (horário de Brasília), a tabela zera:</b> todo mundo
          volta a 0 PR e ao posicionamento. É o que faz o número voltar a valer o que vale.</li>
          <li>Na virada, as primeiras posições levam <b>prêmio</b> (boosts): o pódio leva
          ${premiosPvp[0]}; o resto do Challenger, ${premiosPvp[1]}; e o Mestre, ${premiosPvp[2]}.
          Só entra quem jogou nas últimas ${N(PVP_DECAIMENTO_HORAS, c.lang)} horas.</li>
          <li>O botão <b>🏆 Recompensas</b>, logo abaixo da <b>Fila automática</b>, abre essa tabela
          com quanto falta para a virada e em que faixa você está.</li>
        </ul>

        <h4>Fila automática (VIP)</h4>
        <p>Assinantes podem deixar a fila ligada: acabou uma partida, a próxima busca começa
        sozinha ${espera} segundos depois. Desliga quando você cancela na mão ou quando a equipe
        fica vazia.</p>

        <h4>O ranqueado no perfil</h4>
        <ul>
          <li>O card <b>ELO</b> da Ficha do Treinador mostra o <b>emblema</b>, o tier com a divisão
          e o <b>PR</b> — no seu perfil e no de quem você abrir pelo ranking, pelo chat ou pela
          lista de amigos. Quem ainda está no posicionamento aparece como <b>Não
          classificado</b>, sem emblema e sem PR.</li>
          <li>A <b>equipe do PvP Ranqueado é pública</b>: qualquer um vê no seu perfil.</li>
          <li>Para o <a data-cap="campeonato">Campeonato</a> dá para escolher outra equipe, que
          <b>não aparece</b> no perfil de ninguém.</li>
        </ul>`,
        en: `
        <p><b>One versus one, against someone of your rank.</b> You set up a team, join the
        queue and the match plays out <b>on its own</b> — there is nothing to click during the
        fight. One number is at stake: your <b>ranking points (PR)</b>. Tier, division and the
        progress bar all derive from it.</p>

        <h4>How it works, in three steps</h4>
        <ol class="wk-passos">
          <li><b>Set up your PvP team</b> — up to <b>${N(PVP_TIME_MAX, c.lang)} pokémon</b>, in
          the order they enter. It is <b>separate from your hunt team</b>: changing one does not
          touch the other. The first one opens the fight; the rest come in as the previous falls.</li>
          <li><b>Search for a match.</b> You may close the screen and keep hunting — the search
          goes on, and a small badge stays at the top ("PvP queue · 0:42") with an × to cancel.</li>
          <li><b>The match runs by itself.</b> A map opens, both teams fight, and at the end the
          screen tells you how much PR you gained or lost.</li>
        </ol>

        <h4>House rules</h4>
        ${tabela(
    [c.r.regra, c.r.valor],
    `<tr><td>Format</td><td>1 vs 1, <b>100% automatic</b></td></tr>
           <tr><td>Trainer level</td><td class="wk-num destaque">${N(PVP_NIVEL_MIN, c.lang)}</td></tr>
           <tr><td>Pokémon on the team</td><td class="wk-num">${N(PVP_TIME_MIN, c.lang)} to ${N(PVP_TIME_MAX, c.lang)}</td></tr>
           <tr><td>Entry cost</td><td><b>none</b> — no token, no gold, no fee</td></tr>
           <tr><td>Does losing cost XP?</td><td><b>no</b> — PR only</td></tr>
           <tr><td>Between a match and the next queue</td><td class="wk-num">${espera} s</td></tr>
           <tr><td>Meeting the same opponent again</td><td>avoided for ${revancheMin} min — and pays full PR</td></tr>`,
  )}

        <h4>The seven ranks</h4>
        ${tabelaDeRanks(c)}
        <p>Inside each tier the division runs from <b>I</b> to <b>III</b>, every
        ${N(PVP_PONTOS_POR_DIVISAO, c.lang)} PR. <b>I is the entry and III is the top</b> — Gold
        III beats Gold I. That is the reverse of League of Legends, on purpose: there the
        inverted order is a leftover from an old system.</p>

        ${nota(`<b>Master and Challenger are SLOTS, not points.</b> Passing ${elite} PR puts you
        in line: the <b>top ${N(PVP_VAGAS_CHALLENGER, c.lang)}</b> places on the ladder are
        Challenger and places ${N(PVP_VAGAS_CHALLENGER + 1, c.lang)} to
        <b>${N(PVP_VAGAS_MESTRE, c.lang)}</b> are Master. While no slot is free you show up as
        Diamond. Points inflate over time; positions do not — "being in the top
        ${N(PVP_VAGAS_CHALLENGER, c.lang)} on the server" will mean the same thing a year from
        now.`)}

        <h4>Placement: your first ${posic}</h4>
        <p>For your <b>first ${posic} matches</b> you show as <b>Unranked</b>, you are not on the
        ladder, and your PR is capped at <b>${teto}</b> — the top of Bronze. Everyone starts at
        the bottom of the stairs; the climb <b>is</b> the game.</p>

        <h4>What each match is worth</h4>
        <p>It is chess Elo: what decides is the <b>rank gap</b> between the two of you.</p>
        <ul>
          <li>Against someone at your level the swing is small and even.</li>
          <li><b>Beating someone far above you</b> pays a lot — and costs them a lot.</li>
          <li><b>Losing to someone far below you</b> is the most expensive defeat there is.</li>
        </ul>
        <p>With one difference worth understanding: <b>a loss charges ${atrito}% of what a win
        would pay</b>. It is not zero-sum, and that is deliberate — with everyone starting from
        the floor, a zero-sum ladder would make Diamond and above <b>unreachable</b>, because
        there would be nowhere for the points to come from. With the friction, winning about
        half climbs slowly and winning under ~41% slides down.</p>

        ${nota(`<b>Tier shield:</b> just promoted? The first loss at the floor of your new tier
        does not demote you. Dropping from Gold back to Silver on the very next match is the bad
        feeling the shield exists to prevent.`)}

        <h4>Inactivity and season</h4>
        <ul>
          <li><b>${N(PVP_DECAIMENTO_HORAS, c.lang)} hours without playing</b> (one day) drop Master
          and Challenger to <b>Diamond</b>: the points fall to <b>one above the top Diamond</b> in
          the table, and the slot goes to whoever is playing. To come back, you climb to 1,500 RP
          again. While you are in the elite, a <b>clock</b> on your card shows how long is left —
          and every ranked match resets it.</li>
          <li><b>Every Monday, 00:00 (Brasília time), the ladder resets:</b> everyone goes back to
          0 PR and to placement. That is what makes the number mean what it means again.</li>
          <li>At the turn the top places get a <b>prize</b> (boosts): the podium takes
          ${premiosPvp[0]}; the rest of Challenger, ${premiosPvp[1]}; and Master, ${premiosPvp[2]}.
          Only players who played in the last ${N(PVP_DECAIMENTO_HORAS, c.lang)} hours count.</li>
          <li>The <b>🏆 Rewards</b> button, right below <b>Auto queue</b>, opens this table with the
          time left until the reset and which bracket you are in.</li>
        </ul>

        <h4>Auto-queue (VIP)</h4>
        <p>Subscribers can leave the queue on: when a match ends, the next search starts by itself
        ${espera} seconds later. It switches off when you cancel by hand or when the team goes
        empty.</p>

        <h4>Ranked on your profile</h4>
        <ul>
          <li>The <b>ELO</b> card on the Trainer Sheet shows the <b>emblem</b>, the tier with its
          division and the <b>PR</b> — on your profile and on anyone's you open from the rankings,
          the chat or the friends list. Players still in placement show as <b>Unranked</b>, with no
          emblem and no PR.</li>
          <li>Your <b>Ranked PvP team is public</b>: anyone sees it on your profile.</li>
          <li>For the <a data-cap="campeonato">Championship</a> you can pick another team, which
          <b>never shows</b> on anyone's profile.</li>
        </ul>`,
        es: `
        <p><b>Uno contra uno, contra alguien de tu rango.</b> Armas el equipo, entras a la cola y
        la partida ocurre <b>sola</b> — no hay nada que pulsar durante la pelea. Lo que está en
        juego es un solo número: los <b>puntos de clasificación (PR)</b>. Tier, división y la
        barrita de la pantalla salen todos de él.</p>

        <h4>Cómo funciona, en tres pasos</h4>
        <ol class="wk-passos">
          <li><b>Arma el equipo de PvP</b> — hasta <b>${N(PVP_TIME_MAX, c.lang)} pokémon</b>, en
          el orden en que entran. Es <b>independiente del equipo de cacería</b>: tocar uno no
          toca el otro. El primero abre la pelea; los demás entran cuando cae el anterior.</li>
          <li><b>Busca partida.</b> Puedes cerrar la pantalla y seguir cazando — la búsqueda
          continúa, y arriba queda un aviso pequeño ("En cola PvP · 0:42") con una × para
          cancelar.</li>
          <li><b>La partida corre sola.</b> Se abre un mapa, los dos equipos pelean, y al final la
          pantalla dice cuánto PR ganaste o perdiste.</li>
        </ol>

        <h4>Las reglas de la casa</h4>
        ${tabela(
    [c.r.regra, c.r.valor],
    `<tr><td>Formato</td><td>1 contra 1, <b>100% automático</b></td></tr>
           <tr><td>Nivel de entrenador</td><td class="wk-num destaque">${N(PVP_NIVEL_MIN, c.lang)}</td></tr>
           <tr><td>Pokémon en el equipo</td><td class="wk-num">${N(PVP_TIME_MIN, c.lang)} a ${N(PVP_TIME_MAX, c.lang)}</td></tr>
           <tr><td>Costo de entrada</td><td><b>nada</b> — sin ficha, sin oro, sin tasa</td></tr>
           <tr><td>¿Perder cuesta XP?</td><td><b>no</b> — solo PR</td></tr>
           <tr><td>Entre una partida y la cola siguiente</td><td class="wk-num">${espera} s</td></tr>
           <tr><td>Reencontrar al mismo rival</td><td>evitado por ${revancheMin} min — y paga PR completo</td></tr>`,
  )}

        <h4>Los siete rangos</h4>
        ${tabelaDeRanks(c)}
        <p>Dentro de cada tier la división va de <b>I</b> a <b>III</b>, cada
        ${N(PVP_PONTOS_POR_DIVISAO, c.lang)} PR. <b>I es la entrada y III es la cima</b> — Oro III
        es mejor que Oro I. Es al revés que en League of Legends, a propósito: allí el orden
        invertido es herencia de un sistema viejo.</p>

        ${nota(`<b>Maestro y Challenger son PLAZAS, no puntos.</b> Pasar los ${elite} PR te pone
        en lista de espera: los <b>${N(PVP_VAGAS_CHALLENGER, c.lang)} primeros</b> puestos de la
        tabla son Challenger y del ${N(PVP_VAGAS_CHALLENGER + 1, c.lang)}º al
        <b>${N(PVP_VAGAS_MESTRE, c.lang)}º</b> es Maestro. Mientras no haya plaza apareces como
        Diamante. Los puntos se inflan con el tiempo; la posición no — "estar entre los
        ${N(PVP_VAGAS_CHALLENGER, c.lang)} mejores del servidor" querrá decir lo mismo dentro de
        un año.`)}

        <h4>Colocación: las ${posic} primeras</h4>
        <p>En tus <b>${posic} primeras partidas</b> apareces como <b>Sin clasificar</b>, no entras
        en la tabla, y el PR no pasa de <b>${teto}</b> — la cima del Bronce. Todo el mundo empieza
        al pie de la escalera; la subida <b>es</b> el juego.</p>

        <h4>Cuánto vale cada partida</h4>
        <p>Es el Elo del ajedrez: lo que decide es la <b>diferencia de rango</b> entre los dos.</p>
        <ul>
          <li>Contra alguien de tu nivel el movimiento es pequeño y parejo.</li>
          <li><b>Ganarle a quien está muy por encima</b> paga mucho — y a él le cuesta mucho.</li>
          <li><b>Perder contra quien está muy por debajo</b> es la derrota más cara que existe.</li>
        </ul>
        <p>Con una diferencia que vale entender: <b>la derrota cobra el ${atrito}% de lo que
        pagaría la victoria</b>. No es suma cero, y es a propósito — con todos empezando desde el
        suelo, una escalera de suma cero dejaría Diamante y arriba <b>inalcanzables</b>, porque no
        habría de dónde salieran los puntos. Con el roce, quien gana cerca de la mitad sube
        despacio y quien gana menos de ~41% baja.</p>

        ${nota(`<b>Escudo de tier:</b> ¿acabas de subir? La primera derrota en el suelo de tu tier
        nuevo no te baja. Caer de Oro a Plata en la partida siguiente al ascenso es la mala
        sensación que el escudo existe para evitar.`)}

        <h4>Inactividad y temporada</h4>
        <ul>
          <li><b>${N(PVP_DECAIMENTO_HORAS, c.lang)} horas sin jugar</b> (un día) bajan a Maestro y
          Challenger a <b>Diamante</b>: los puntos caen a <b>uno por encima del primer
          Diamante</b> de la tabla, y la plaza va para quien está jugando. Para volver, hay que
          subir de nuevo hasta los 1.500 PR. Mientras estás en la élite, un <b>reloj</b> en tu
          tarjeta muestra cuánto falta — y cada partida clasificatoria lo reinicia.</li>
          <li><b>Cada lunes, 00:00 (hora de Brasilia), la tabla se reinicia:</b> todos vuelven a 0
          PR y a la colocación. Es lo que hace que el número vuelva a valer lo que vale.</li>
          <li>En el cambio los primeros puestos llevan <b>premio</b> (boosts): el podio se lleva
          ${premiosPvp[0]}; el resto del Challenger, ${premiosPvp[1]}; y el Maestro, ${premiosPvp[2]}.
          Solo cuenta quien jugó en las últimas ${N(PVP_DECAIMENTO_HORAS, c.lang)} horas.</li>
          <li>El botón <b>🏆 Recompensas</b>, justo debajo de la <b>Cola automática</b>, abre esta
          tabla con cuánto falta para el cambio y en qué franja estás.</li>
        </ul>

        <h4>Cola automática (VIP)</h4>
        <p>Los suscriptores pueden dejar la cola encendida: al terminar una partida, la siguiente
        búsqueda arranca sola ${espera} segundos después. Se apaga cuando cancelas a mano o cuando
        el equipo queda vacío.</p>

        <h4>El clasificatorio en el perfil</h4>
        <ul>
          <li>La tarjeta <b>ELO</b> de la Ficha del Entrenador muestra el <b>emblema</b>, el tier
          con la división y los <b>PR</b> — en tu perfil y en el de quien abras desde la
          clasificación, el chat o la lista de amigos. Quien sigue en la colocación aparece como
          <b>Sin clasificar</b>, sin emblema y sin PR.</li>
          <li>El <b>equipo del PvP Clasificatorio es público</b>: cualquiera lo ve en tu
          perfil.</li>
          <li>Para el <a data-cap="campeonato">Campeonato</a> puedes elegir otro equipo, que
          <b>no aparece</b> en el perfil de nadie.</li>
        </ul>`,
      };
    },
  },


  // ------------------------------------------------------------ campeonatos
  //
  // Datas, requisito, restrições, intervalo das rodadas e prêmios saem do CALENDÁRIO de
  // `shared/campeonato.mjs`, o mesmo que o servidor usa para aceitar inscrição e jogar a chave.
  // Nada aqui é data escrita à mão: o capítulo pergunta ao calendário qual é a próxima edição
  // de cada tipo e acompanha sozinho a virada do mês, para sempre.
  // ------------------------------------------------ a bancada de testes do PvP
  // ---------------------------------------------------------- 14b. PvP amistoso
  {
    id: 'amistoso',
    titulo: { pt: 'PvP amistoso', en: 'Friendly PvP', es: 'PvP amistoso' },
    grupo: 'mundo',
    html: (c) => ({
      pt: `
        <p>Um desafio entre <b>amigos</b>, pela conversa da <a data-cap="inicio">Lista de
        Amigos</a>. Abra a conversa com o amigo e clique em <b>⚔ PvP amistoso</b>.</p>
        <ul>
          <li>O convite aparece na conversa dos dois, e o amigo tem <b>5 minutos</b> para
          <b>Aceitar</b> ou <b>Recusar</b>. Quem desafiou pode cancelar enquanto espera.</li>
          <li>Só vale para amigo <b>online</b>, e é um convite pendente por vez.</li>
          <li>Aceitou, a luta acontece na hora com as <b>regras do <a data-cap="pvp">PvP
          Ranqueado</a></b>: a equipe de PvP de cada um (quem não montou luta com a equipe de hunt), a
          mesma arena e a mesma régua de nível. A fita abre para os dois.</li>
          <li><b>Não vale PR nem prêmio</b> — é só pela honra.</li>
          <li>Depois da luta, <b>os dois esperam 5 minutos</b> para jogar outro amistoso, com qualquer
          amigo. Quem chamar alguém nessa espera vê quanto tempo falta.</li>
          <li>A conversa guarda o resultado, e o <b>▶ Assistir</b> reabre a fita por 30 minutos.</li>
        </ul>`,
      en: `
        <p>A challenge between <b>friends</b>, through the <a data-cap="inicio">Friends
        List</a> chat. Open the chat with your friend and click <b>⚔ Friendly PvP</b>.</p>
        <ul>
          <li>The invite shows up in both chats, and your friend has <b>5 minutes</b> to
          <b>Accept</b> or <b>Decline</b>. The challenger can cancel while waiting.</li>
          <li>Only for friends who are <b>online</b>, one pending invite at a time.</li>
          <li>Once accepted, the battle happens right away under <b><a data-cap="pvp">Ranked PvP</a>
          rules</b>: each player's PvP team (without one, the hunting team), the same arena and the
          same level curve. The replay opens for both.</li>
          <li><b>No PR and no prizes</b> — just for glory.</li>
          <li>After the battle, <b>both wait 5 minutes</b> before another friendly, with any friend.
          Whoever calls someone during that wait sees how long is left.</li>
          <li>The chat keeps the result, and <b>▶ Watch</b> reopens the replay for 30 minutes.</li>
        </ul>`,
      es: `
        <p>Un desafío entre <b>amigos</b>, por la conversación de la <a data-cap="inicio">Lista
        de Amigos</a>. Abre la conversación con tu amigo y pulsa <b>⚔ PvP amistoso</b>.</p>
        <ul>
          <li>La invitación aparece en la conversación de los dos, y el amigo tiene <b>5 minutos</b>
          para <b>Aceptar</b> o <b>Rechazar</b>. Quien desafió puede cancelar mientras espera.</li>
          <li>Solo para amigos <b>conectados</b>, y una invitación pendiente a la vez.</li>
          <li>Al aceptar, la batalla ocurre en el momento con las <b>reglas del <a data-cap="pvp">PvP
          Clasificatorio</a></b>: el equipo de PvP de cada uno (sin uno, el equipo de caza), la misma
          arena y la misma regla de nivel. La grabación se abre para los dos.</li>
          <li><b>No vale PR ni premio</b> — solo por el honor.</li>
          <li>Después de la batalla, <b>los dos esperan 5 minutos</b> para otro amistoso, con
          cualquier amigo. Quien llame a alguien en esa espera ve cuánto falta.</li>
          <li>La conversación guarda el resultado, y <b>▶ Ver</b> reabre la grabación por 30 minutos.</li>
        </ul>`,
    }),
  },

  {
    id: 'treinamento',
    titulo: { pt: 'Área de Treinamento', en: 'Training Area', es: 'Área de Entrenamiento' },
    grupo: 'mundo',
    html: (c) => {
      const casas = N(TREINO_MAX_LADO, c.lang);
      const min = Math.round(TREINO_COOLDOWN_MS / 60000);
      return {
        pt: `
        <p><b>Uma bancada de testes, sem nada em jogo.</b> Na aba <b>Treinamento</b> do PvP você
        monta dois lados, manda lutar e assiste. Não há XP, Coin, item, pedra nem ponto de
        ranking — e <b>nada é gravado</b>.</p>

        <h4>Como se monta</h4>
        <ol class="wk-passos">
          <li><b>Até ${casas} pokémon de cada lado</b>, escolhidos casa a casa. A casa 1 é quem
          entra em campo primeiro.</li>
          <li>Em cada casa você escolhe entre <b>um pokémon seu</b> e um <b>pokémon teste</b>.</li>
          <li>O <b>pokémon teste</b> é de mentira: você diz a espécie, o nível, se é shiny, a
          potência, a qualidade e os seis IVs. Ele existe só naquela luta.</li>
          <li>Clique em <b>Lutar</b>. A fita abre na arena dos ginásios, com o mesmo tocador do
          desafio ao líder.</li>
        </ol>

        <h4>As regras da luta são as do Ranqueado</h4>
        <p>Mesma arena, mesmo simulador e a mesma régua de nível do
        <a data-cap="pvp">PvP Ranqueado</a> e do <a data-cap="ginasios">Ginásio</a> — inteiro até
        150 e comprimido daí para cima. Treinar com outra régua não treinaria nada.</p>

        <p><b>Os lados são independentes:</b> 5 × 1 é uma luta válida. A bancada não pede
        equilíbrio — quem decide o que quer perguntar é você.</p>

        <h4>O seu pokémon não entra na arena</h4>
        <p>Entra uma <b>cópia</b> dele, com os mesmos números de nascimento. O original não perde
        HP, não ganha XP, não sai do lugar e não fica sabendo que a luta aconteceu. O pokémon
        teste, por sua vez, <b>não vai para o Depot</b> e não conta na Pokédex.</p>

        ${nota(`<b>Uma batalha a cada ${min} minutos por conta.</b> A espera vale em qualquer
        aparelho e não zera ao sair e entrar de novo.`)}

        <h4>Para que serve</h4>
        <ul class="wk-lista">
          <li>descobrir qual dos seus pokémon é mais forte de verdade, e não na conta de cabeça;</li>
          <li>comparar duas equipes antes de levar uma para o Ranqueado ou para a guerra;</li>
          <li>ver quanto um nível, um IV ou uma potência a mais mudam a luta;</li>
          <li>montar a equipe contra um oponente que você inventa — o time de alguém que te
          venceu, por exemplo.</li>
        </ul>`,
        en: `
        <p><b>A test bench, with nothing at stake.</b> In the PvP <b>Training</b> tab you build
        two sides, hit fight and watch. No XP, Coins, items, stones or ranking points — and
        <b>nothing is saved</b>.</p>

        <h4>How to build it</h4>
        <ol class="wk-passos">
          <li><b>Up to ${casas} pokémon per side</b>, picked slot by slot. Slot 1 enters first.</li>
          <li>In each slot you choose between <b>one of your pokémon</b> and a <b>test pokémon</b>.</li>
          <li>The <b>test pokémon</b> is make-believe: you set the species, level, shiny,
          potential, quality and the six IVs. It exists only for that fight.</li>
          <li>Hit <b>Fight</b>. The replay opens in the gym arena, in the same player as the
          leader challenge.</li>
        </ol>

        <h4>The fight follows ranked rules</h4>
        <p>Same arena, same simulator and the same level ruler as
        <a data-cap="pvp">Ranked PvP</a> and the <a data-cap="ginasios">Gyms</a> — full up to 150
        and compressed above it. Training under other rules would train nothing.</p>

        <p><b>The sides are independent:</b> 5 × 1 is a valid fight. The bench asks for no
        balance — you decide what you want to ask it.</p>

        <h4>Your pokémon never enters the arena</h4>
        <p>A <b>copy</b> does, with the same birth numbers. The original loses no HP, gains no
        XP, does not move and never learns the fight happened. The test pokémon, in turn,
        <b>does not go to your Depot</b> and does not count in the Pokédex.</p>

        ${nota(`<b>One battle every ${min} minutes per account.</b> The wait applies on any
        device and does not reset when you log out and back in.`)}

        <h4>What it is for</h4>
        <ul class="wk-lista">
          <li>finding out which of your pokémon is actually stronger, instead of guessing;</li>
          <li>comparing two teams before taking one to ranked or to the war;</li>
          <li>seeing how much one more level, IV or potential changes a fight;</li>
          <li>building a team against an opponent you invent — the team that just beat you,
          for instance.</li>
        </ul>`,
        es: `
        <p><b>Un banco de pruebas, sin nada en juego.</b> En la pestaña <b>Entrenamiento</b> del
        PvP armas dos lados, mandas pelear y miras. No hay XP, Coins, objetos, piedras ni puntos
        de clasificación — y <b>nada se guarda</b>.</p>

        <h4>Cómo se arma</h4>
        <ol class="wk-passos">
          <li><b>Hasta ${casas} pokémon por lado</b>, elegidos casilla por casilla. La casilla 1
          entra primero.</li>
          <li>En cada casilla eliges entre <b>un pokémon tuyo</b> y un <b>pokémon de prueba</b>.</li>
          <li>El <b>pokémon de prueba</b> es de mentira: defines la especie, el nivel, si es
          shiny, la potencia, la calidad y los seis IVs. Existe solo en esa pelea.</li>
          <li>Pulsa <b>Pelear</b>. La repetición abre en la arena de los gimnasios, con el mismo
          reproductor del desafío al líder.</li>
        </ol>

        <h4>Las reglas son las del Clasificatorio</h4>
        <p>Misma arena, mismo simulador y la misma regla de nivel del
        <a data-cap="pvp">PvP Clasificatorio</a> y de los <a data-cap="ginasios">Gimnasios</a> —
        entero hasta 150 y comprimido de ahí para arriba.</p>

        <p><b>Los lados son independientes:</b> 5 × 1 es una pelea válida.</p>

        <h4>Tu pokémon no entra a la arena</h4>
        <p>Entra una <b>copia</b>, con los mismos números de nacimiento. El original no pierde
        HP, no gana XP, no se mueve y ni se entera. El pokémon de prueba <b>no va a tu Depot</b>
        y no cuenta en la Pokédex.</p>

        ${nota(`<b>Una pelea cada ${min} minutos por cuenta.</b> La espera vale en cualquier
        aparato y no se reinicia al salir y volver a entrar.`)}

        <h4>Para qué sirve</h4>
        <ul class="wk-lista">
          <li>descubrir cuál de tus pokémon es más fuerte de verdad;</li>
          <li>comparar dos equipos antes de llevar uno al clasificatorio o a la guerra;</li>
          <li>ver cuánto cambian un nivel, un IV o una potencia más;</li>
          <li>armar el equipo contra un oponente que tú inventas.</li>
        </ul>`,
      };
    },
  },
  {
    id: 'campeonato',
    titulo: { pt: 'Campeonatos', en: 'Championships', es: 'Campeonatos' },
    grupo: 'mundo',
    html: (c) => {
      const loc = c.lang === 'pt' ? 'pt-BR' : c.lang === 'es' ? 'es-ES' : 'en-US';
      // O CALENDÁRIO é gerado, não cadastrado: `campeonatoAtivo` devolve a edição que está
      // acontecendo agora, e `campeonatoDe` a de qualquer mês. Este capítulo mostra a PRÓXIMA de
      // cada tipo e acompanha sozinho a virada do mês — nenhuma data escrita à mão aqui.
      const agora = Date.now();
      const proxima = (tipo) => {
        const d = new Date(agora);
        for (let n = 0; n <= 2; n++) {
          const t = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
          const x = campeonatoDe(tipo, Math.floor(t / 12), (t % 12) + 1);
          if (x && agora < x.fimEm) return x;
        }
        return campeonatoDe(tipo, d.getUTCFullYear(), d.getUTCMonth() + 1);
      };
      const M = proxima('mundial');
      const A = proxima('amador');
      // As datas são dias de Brasília escritos como AAAA-MM-DD; o meio-dia UTC não muda de dia
      // em fuso nenhum das Américas nem da Europa.
      const dia = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(loc, {
        day: 'numeric', month: 'long', timeZone: 'UTC',
      });
      const hora = new Date(M.lutasEm).toLocaleTimeString(loc, {
        hour: '2-digit', minute: '2-digit', timeZone: FUSO_CAMPEONATO,
      });
      const minRodada = N(Math.round(M.intervaloOndaMs / 60_000), c.lang);
      const max = N(PVP_TIME_MAX, c.lang);
      const reais = (v) => v.toLocaleString(loc, { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
      const [m1, m2, m3] = M.premios.map(reais);
      const [a1, a2, a3] = A.premios.map(reais);
      const nvM = N(M.nivelMin, c.lang);
      const nvA = N(A.nivelMin, c.lang);
      return {
        pt: `
        <p>Os torneios do PokéIdle, com <b>prêmio em dinheiro</b>. São <b>dois por mês</b>, e eles
        se repetem para sempre no mesmo calendário. Ficam no menu do topo, em <b>Torneio</b>, que
        abre a <b>lista de campeonatos</b> — os que vêm por aí e os que já passaram.</p>

        ${tabela(
          ['', 'Campeonato Mundial', 'Campeonato Amador'],
          `<tr><td>Dia das lutas</td><td>último dia do mês, às ${hora}</td><td>dia 15, às ${hora}</td></tr>
           <tr><td>Inscrições abrem</td><td>dia 16</td><td>dia 1º</td></tr>
           <tr><td>Inscrições fecham</td><td>fim do dia ${N(Number(M.ultimoDiaInscricao.slice(8)), c.lang)}</td><td>fim do dia 13</td></tr>
           <tr><td>Dia de análise</td><td>a véspera</td><td>dia 14</td></tr>
           <tr><td>Nível mínimo</td><td class="wk-num">${nvM}</td><td class="wk-num">${nvA}</td></tr>
           <tr><td>Shiny e P5</td><td>liberados</td><td class="destaque">PROIBIDOS</td></tr>
           <tr><td>Premiação</td><td class="wk-num">${m1} / ${m2} / ${m3}</td><td class="wk-num">${a1} / ${a2} / ${a3}</td></tr>`,
        )}
        <p>A próxima edição do <b>Mundial</b> é dia <b>${dia(M.dia)}</b> (inscrições até o fim do
        dia <b>${dia(M.ultimoDiaInscricao)}</b>); a do <b>Amador</b>, dia <b>${dia(A.dia)}</b>
        (inscrições até <b>${dia(A.ultimoDiaInscricao)}</b>). Todos os horários são de Brasília.</p>

        ${nota(`<b>O Amador não aceita shiny nem P5.</b> É o que ele é: um campeonato para quem
        ainda não tem a coleção do topo. Um shiny ou um pokémon de potência 5 é recusado na hora de
        salvar a equipe — e, se você não escolher equipe nenhuma, os shinys e P5 da sua equipe de
        PvP simplesmente não entram em campo.`, 'aviso')}

        <p>No Brasil, o prêmio é pago por <b>PIX</b>. Fora do Brasil, vai o valor equivalente em
        <b>USDT na rede Solana</b>, convertido na hora do pagamento.</p>

        <h4>Inscrição</h4>
        <ul>
          <li>Na lista, abra o campeonato e clique em <b>Registrar</b>. O Mundial pede <b>nível
          ${nvM}</b> de treinador; o Amador, <b>nível ${nvA}</b>.</li>
          <li>Dá para estar inscrito nos <b>dois ao mesmo tempo</b> — são campeonatos separados,
          com equipes separadas.</li>
          <li>Até o prazo dá para <b>cancelar</b> e se inscrever de novo.</li>
          <li>A aba <b>Participantes</b> mostra cada inscrito, com a skin, o nível, o elo, o PR e a
          seed. Tem busca por nick, e clicar no card abre o perfil.</li>
        </ul>

        <h4>A sua equipe</h4>
        <p>Depois de se inscrever, a faixa <b>Sua equipe do campeonato</b> mostra com quem você
        vai lutar.</p>
        <ul>
          <li><b>Selecionar minha Equipe</b> abre a sua coleção inteira (equipe e depot), com busca e
          filtros. Marque até <b>${max} pokémon</b>: o número no card é a ordem em que entram em
          campo. <b>Salvar equipe</b> grava.</li>
          <li>Essa equipe é <b>só daquele campeonato</b>: não muda a do PvP Ranqueado, não muda a do
          outro campeonato e <b>não aparece no perfil</b> de ninguém.</li>
          <li>Quem não escolher luta com a equipe do <a data-cap="pvp">PvP Ranqueado</a>, que é
          pública no perfil. <b>Usar a equipe do PvP</b> apaga a escolha e volta para ela.</li>
          <li><b>A equipe fica aberta o dia de análise inteiro</b> e só congela às <b>23h da
          véspera</b> — é para isso que o dia de análise existe: você já viu a chave e sabe contra
          quem vai lutar. Pokémon vendido ou anunciado no Mercado até lá fica de fora.</li>
        </ul>
        ${nota(`<b>Sem equipe no congelamento, todas as suas partidas são W.O.</b> A faixa avisa
        antes do prazo.`, 'aviso')}

        <h4>Seeds e chave</h4>
        <ul>
          <li>A <b>seed</b> é a sua posição na Tabela do PvP Ranqueado entre os inscritos: o mais
          alto é a Seed 1. Quem ainda está no posicionamento vem depois, pelos pontos.</li>
          <li>Até o prazo as seeds são <b>provisórias</b> e acompanham a Tabela. No fechamento
          elas <b>congelam</b> e a chave é publicada — e você passa o <b>dia de análise</b>
          inteiro olhando quem vai enfrentar.</li>
          <li>Na 1ª rodada a Seed 1 enfrenta a última, a 2 enfrenta a penúltima, e assim por
          diante. A 1 e a 2 ficam em lados opostos e só se cruzam na final.</li>
          <li>Se os inscritos não fecham uma chave cheia (4, 8, 16, 32…), as melhores seeds
          <b>avançam direto</b> para a 2ª rodada.</li>
        </ul>

        <h4>O formato</h4>
        <ul>
          <li><b>Eliminação dupla.</b> Perdeu na chave dos vencedores, você cai para a dos
          perdedores. Perdeu na dos perdedores, está fora.</li>
          <li><b>Grande final</b> em partida única: o campeão dos vencedores contra o campeão dos
          perdedores. O <b>3º lugar</b> é de quem perde a final da chave dos perdedores.</li>
          <li><b>A luta é a do PvP Ranqueado</b>: automática, com as mesmas regras.</li>
        </ul>

        <h4>As partidas rodam sozinhas</h4>
        <p>À <b>meia-noite do dia do campeonato</b> o servidor joga a chave <b>uma rodada a cada
        ${minRodada} minutos</b>, até a grande final. Ninguém precisa estar online.</p>
        <ul>
          <li>Na aba <b>Bracket</b>, toda partida jogada tem <b>▶ Assistir</b>: qualquer jogador vê o
          replay de qualquer partida.</li>
          <li>A chave acende o vencedor, mostra o placar de abates e marca W.O., título e 3º
          lugar. <b>Ver minha chave</b> leva direto ao seu caminho.</li>
          <li>Cada inscrito aparece como invicto, na chave dos perdedores ou eliminado. No fim, a
          <b>Premiação</b> mostra os três colocados.</li>
        </ul>

        <h4>Até quando dá para assistir</h4>
        <p>Os replays de um campeonato ficam disponíveis <b>até a chave do campeonato seguinte ser
        publicada</b> — na prática, umas duas semanas. Depois disso a tela mostra <b>só o pódio</b>,
        e o botão de assistir some.</p>
        ${nota(`Guardar a fita de todas as partidas de todos os campeonatos, para sempre, seria
        encher o servidor de vídeo que ninguém abre — e o processamento faz falta para o jogo. Por
        isso o replay tem prazo. O <b>resultado</b> não: a chave inteira, com todos os confrontos,
        continua lá para sempre.`)}`,
        en: `
        <p>PokéIdle's tournaments, with a <b>cash prize</b>. There are <b>two a month</b>, and they
        repeat forever on the same calendar. They live in the top menu, under <b>Tournament</b>,
        which opens the <b>championship list</b> — the ones coming up and the ones already played.</p>

        ${tabela(
          ['', 'World Championship', 'Amateur Championship'],
          `<tr><td>Fight day</td><td>last day of the month, at ${hora}</td><td>the 15th, at ${hora}</td></tr>
           <tr><td>Sign-ups open</td><td>the 16th</td><td>the 1st</td></tr>
           <tr><td>Sign-ups close</td><td>end of the ${N(Number(M.ultimoDiaInscricao.slice(8)), c.lang)}th</td><td>end of the 13th</td></tr>
           <tr><td>Scouting day</td><td>the day before</td><td>the 14th</td></tr>
           <tr><td>Minimum level</td><td class="wk-num">${nvM}</td><td class="wk-num">${nvA}</td></tr>
           <tr><td>Shiny and P5</td><td>allowed</td><td class="destaque">BANNED</td></tr>
           <tr><td>Prizes</td><td class="wk-num">${m1} / ${m2} / ${m3}</td><td class="wk-num">${a1} / ${a2} / ${a3}</td></tr>`,
        )}
        <p>The next <b>World</b> edition is on <b>${dia(M.dia)}</b> (sign-ups until the end of
        <b>${dia(M.ultimoDiaInscricao)}</b>); the next <b>Amateur</b> one is on
        <b>${dia(A.dia)}</b> (sign-ups until <b>${dia(A.ultimoDiaInscricao)}</b>). All times are
        Brasília time.</p>

        ${nota(`<b>The Amateur takes no shinies and no P5.</b> That is the whole point of it: a
        championship for players who do not have the top-end collection yet. A shiny or a
        power-5 pokémon is refused when you save the team — and if you pick no team at all, the
        shinies and P5s in your PvP team simply do not take the field.`, 'aviso')}

        <p>In Brazil, the prize is paid by <b>PIX</b>. Outside Brazil, the equivalent amount goes
        out in <b>USDT on the Solana network</b>, converted at the time of payment.</p>

        <h4>Signing up</h4>
        <ul>
          <li>From the list, open the championship and click <b>Register</b>. World asks for trainer
          <b>level ${nvM}</b>; Amateur, <b>level ${nvA}</b>.</li>
          <li>You can be in <b>both at once</b> — they are separate championships, with separate
          teams.</li>
          <li>Until the deadline you can <b>cancel</b> and sign up again.</li>
          <li>The <b>Participants</b> tab shows every entrant with their skin, level, elo, PR and
          seed. It has a nick search, and clicking a card opens the profile.</li>
        </ul>

        <h4>Your team</h4>
        <p>Once you sign up, the <b>Your championship team</b> strip shows who you will fight
        with.</p>
        <ul>
          <li><b>Select my Team</b> opens your whole collection (team and depot), with search and
          filters. Mark up to <b>${max} pokémon</b>: the number on the card is the order they take
          the field. <b>Save team</b> stores it.</li>
          <li>That team is <b>for that championship only</b>: it does not change your Ranked PvP
          team, does not change the other championship's team and <b>never shows</b> on anyone's
          profile.</li>
          <li>If you do not pick one, you fight with your <a data-cap="pvp">Ranked PvP</a> team,
          which is public on your profile. <b>Use my PvP team</b> clears your pick and goes back to
          it.</li>
          <li><b>The team stays open through the whole scouting day</b> and only freezes at
          <b>11 PM the day before</b> — that is what the scouting day is for: you have already seen
          the bracket and you know who you are up against. A pokémon sold or listed on the Market
          before then is left out.</li>
        </ul>
        ${nota(`<b>With no team at freeze time, every match of yours is a walkover loss.</b> The
        strip warns you before the deadline.`, 'aviso')}

        <h4>Seeds and bracket</h4>
        <ul>
          <li>Your <b>seed</b> is your position on the Ranked PvP ladder among the entrants: the
          highest is Seed 1. Players still in placement come after, by points.</li>
          <li>Until the deadline the seeds are <b>provisional</b> and follow the ladder. At closing
          they <b>freeze</b> and the bracket is published — and you get the whole <b>scouting
          day</b> to study who you will face.</li>
          <li>In round 1, Seed 1 faces the last seed, Seed 2 faces the second-to-last, and so on.
          Seeds 1 and 2 sit on opposite sides and can only meet in the final.</li>
          <li>If the entrants do not fill a full bracket (4, 8, 16, 32…), the best seeds get a
          <b>bye</b> into round 2.</li>
        </ul>

        <h4>The format</h4>
        <ul>
          <li><b>Double elimination.</b> Lose in the winners' bracket and you drop to the losers'
          bracket. Lose in the losers' bracket and you are out.</li>
          <li><b>Grand final</b> in a single match: the winners' champion against the losers'
          champion. <b>3rd place</b> goes to whoever loses the losers' bracket final.</li>
          <li><b>The fight is the Ranked PvP one</b>: automatic, with the same rules.</li>
        </ul>

        <h4>Matches play themselves</h4>
        <p>At <b>midnight on the championship day</b> the server plays the bracket <b>one round
        every ${minRodada} minutes</b>, up to the grand final. Nobody needs to be online.</p>
        <ul>
          <li>In the <b>Bracket</b> tab, every played match has <b>▶ Watch</b>: any player can see
          the replay of any match.</li>
          <li>The bracket lights up the winner, shows the knockout score and marks walkovers, the
          title and 3rd place. <b>View my bracket</b> jumps to your path.</li>
          <li>Each entrant shows as unbeaten, in the losers' bracket or eliminated. At the end, the
          <b>Prizes</b> tab shows the top three.</li>
        </ul>

        <h4>How long replays stay up</h4>
        <p>A championship's replays stay available <b>until the next championship's bracket is
        published</b> — about two weeks in practice. After that the screen shows <b>the podium
        only</b>, and the watch button is gone.</p>
        ${nota(`Keeping the tape of every match of every championship forever would fill the server
        with video nobody opens — and the processing is better spent on the game. So the replay has
        a deadline. The <b>result</b> does not: the whole bracket, with every match-up, stays there
        for good.`)}`,
        es: `
        <p>Los torneos de PokéIdle, con <b>premio en dinero</b>. Son <b>dos al mes</b>, y se repiten
        para siempre en el mismo calendario. Están en el menú superior, en <b>Torneo</b>, que abre
        la <b>lista de campeonatos</b>: los que vienen y los que ya pasaron.</p>

        ${tabela(
          ['', 'Campeonato Mundial', 'Campeonato Amateur'],
          `<tr><td>Día de las peleas</td><td>último día del mes, a las ${hora}</td><td>día 15, a las ${hora}</td></tr>
           <tr><td>Inscripciones abren</td><td>día 16</td><td>día 1</td></tr>
           <tr><td>Inscripciones cierran</td><td>fin del día ${N(Number(M.ultimoDiaInscricao.slice(8)), c.lang)}</td><td>fin del día 13</td></tr>
           <tr><td>Día de análisis</td><td>la víspera</td><td>día 14</td></tr>
           <tr><td>Nivel mínimo</td><td class="wk-num">${nvM}</td><td class="wk-num">${nvA}</td></tr>
           <tr><td>Shiny y P5</td><td>permitidos</td><td class="destaque">PROHIBIDOS</td></tr>
           <tr><td>Premios</td><td class="wk-num">${m1} / ${m2} / ${m3}</td><td class="wk-num">${a1} / ${a2} / ${a3}</td></tr>`,
        )}
        <p>La próxima edición del <b>Mundial</b> es el <b>${dia(M.dia)}</b> (inscripciones hasta el
        final del <b>${dia(M.ultimoDiaInscricao)}</b>); la del <b>Amateur</b>, el
        <b>${dia(A.dia)}</b> (inscripciones hasta el <b>${dia(A.ultimoDiaInscricao)}</b>). Todos
        los horarios son de Brasilia.</p>

        ${nota(`<b>El Amateur no acepta shiny ni P5.</b> Es justo lo que lo define: un campeonato
        para quien todavía no tiene la colección de arriba. Un shiny o un pokémon de potencia 5 se
        rechaza al guardar el equipo — y si no eliges ningún equipo, los shinys y P5 de tu equipo
        de PvP simplemente no salen al campo.`, 'aviso')}

        <p>En Brasil, el premio se paga por <b>PIX</b>. Fuera de Brasil, se envía el valor
        equivalente en <b>USDT en la red Solana</b>, convertido en el momento del pago.</p>

        <h4>Inscripción</h4>
        <ul>
          <li>En la lista, abre el campeonato y pulsa <b>Inscribirse</b>. El Mundial pide <b>nivel
          ${nvM}</b> de entrenador; el Amateur, <b>nivel ${nvA}</b>.</li>
          <li>Puedes estar inscrito en <b>los dos a la vez</b>: son campeonatos separados, con
          equipos separados.</li>
          <li>Hasta el plazo puedes <b>cancelar</b> y volver a inscribirte.</li>
          <li>La pestaña <b>Participantes</b> muestra a cada inscrito con su skin, nivel, elo, PR y
          seed. Tiene búsqueda por nick, y al pulsar la tarjeta se abre el perfil.</li>
        </ul>

        <h4>Tu equipo</h4>
        <p>Después de inscribirte, la franja <b>Tu equipo del campeonato</b> muestra con quién
        vas a pelear.</p>
        <ul>
          <li><b>Seleccionar mi Equipo</b> abre tu colección entera (equipo y depot), con búsqueda y
          filtros. Marca hasta <b>${max} pokémon</b>: el número de la tarjeta es el orden en que
          salen al campo. <b>Guardar equipo</b> lo graba.</li>
          <li>Ese equipo es <b>solo de aquel campeonato</b>: no cambia el del PvP Clasificatorio, no
          cambia el del otro campeonato y <b>no aparece en el perfil</b> de nadie.</li>
          <li>Quien no elige pelea con el equipo del <a data-cap="pvp">PvP Clasificatorio</a>, que
          es público en el perfil. <b>Usar mi equipo del PvP</b> borra la elección y vuelve a
          él.</li>
          <li><b>El equipo sigue abierto todo el día de análisis</b> y solo se congela a las
          <b>23h de la víspera</b>: para eso existe el día de análisis, ya viste el cuadro y sabes
          contra quién peleas. Un pokémon vendido o anunciado en el Mercado antes de eso queda
          fuera.</li>
        </ul>
        ${nota(`<b>Sin equipo al congelar, todas tus partidas se pierden por W.O.</b> La franja
        avisa antes del plazo.`, 'aviso')}

        <h4>Seeds y cuadro</h4>
        <ul>
          <li>La <b>seed</b> es tu posición en la Tabla del PvP Clasificatorio entre los inscritos:
          el más alto es la Seed 1. Quien sigue en la colocación va después, por los puntos.</li>
          <li>Hasta el plazo las seeds son <b>provisionales</b> y siguen la Tabla. Al cierre se
          <b>congelan</b> y se publica el cuadro — y tienes todo el <b>día de análisis</b> para
          estudiar a quién te enfrentas.</li>
          <li>En la 1.ª ronda la Seed 1 se enfrenta a la última, la 2 a la penúltima, y así
          sucesivamente. La 1 y la 2 quedan en lados opuestos y solo se cruzan en la final.</li>
          <li>Si los inscritos no llenan un cuadro completo (4, 8, 16, 32…), las mejores seeds
          <b>pasan directo</b> a la 2.ª ronda.</li>
        </ul>

        <h4>El formato</h4>
        <ul>
          <li><b>Doble eliminación.</b> Si pierdes en el cuadro de ganadores, bajas al de
          perdedores. Si pierdes en el de perdedores, quedas fuera.</li>
          <li><b>Gran final</b> a partida única: el campeón de ganadores contra el campeón de
          perdedores. El <b>3.er puesto</b> es de quien pierde la final del cuadro de
          perdedores.</li>
          <li><b>La pelea es la del PvP Clasificatorio</b>: automática, con las mismas reglas.</li>
        </ul>

        <h4>Las partidas se juegan solas</h4>
        <p>A <b>medianoche del día del campeonato</b> el servidor juega el cuadro <b>una ronda cada
        ${minRodada} minutos</b>, hasta la gran final. Nadie necesita estar conectado.</p>
        <ul>
          <li>En la pestaña <b>Bracket</b>, toda partida jugada tiene <b>▶ Ver</b>: cualquier
          jugador ve el replay de cualquier partida.</li>
          <li>El cuadro ilumina al ganador, muestra el marcador de derrotas y marca W.O., título y
          3.er puesto. <b>Ver mi cuadro</b> lleva directo a tu camino.</li>
          <li>Cada inscrito aparece como invicto, en el cuadro de perdedores o eliminado. Al final,
          la pestaña <b>Premios</b> muestra a los tres primeros.</li>
        </ul>

        <h4>Hasta cuándo se puede ver</h4>
        <p>Los replays de un campeonato quedan disponibles <b>hasta que se publique el cuadro del
        campeonato siguiente</b> — unas dos semanas en la práctica. Después de eso la pantalla
        muestra <b>solo el podio</b>, y el botón de ver desaparece.</p>
        ${nota(`Guardar la cinta de todas las partidas de todos los campeonatos, para siempre,
        llenaría el servidor de vídeo que nadie abre — y el procesamiento hace falta para el juego.
        Por eso el replay tiene plazo. El <b>resultado</b> no: el cuadro entero, con todos los
        enfrentamientos, sigue ahí para siempre.`)}`,
      };
    },
  },

  // ------------------------------------------------------------ 14. ginásios
  {
    id: 'ginasios',
    titulo: { pt: 'Ginásios', en: 'Gyms', es: 'Gimnasios' },
    grupo: 'mundo',
    html: (c) => ({
      pt: `
        <p>São <b>${N(TIPOS_GINASIO.length, c.lang)} ginásios</b>, um para cada tipo elemental.
        Cada um tem um <b>pódio</b> disputado por todo o servidor: quem estiver em <b>1º</b> é o
        <b>líder</b> daquele tipo — e liderar paga <b>+${GINASIO_BUFF_PCT}% de dano</b>.</p>

        <h4>O time do ginásio</h4>
        <ul>
          <li>Até <b>${N(GINASIO_TIME_MAX, c.lang)} pokémon</b>, e <b>todos do tipo do ginásio</b>.
          Tipo duplo entra nos dois: um Charizard vale para <b>FIRE</b> e para <b>FLYING</b>.</li>
          <li><b>Sem espécies repetidas.</b> Cinco cópias do mesmo bicho bom não fazem um time —
          e o pódio é de quem montou um time, não de quem farmou uma espécie.</li>
          <li>Precisa de <b>nível ${N(GINASIO_NIVEL_MIN, c.lang)} de treinador</b> para registrar
          em qualquer ginásio.</li>
          <li>O time registrado <b>continua seu e continua jogável</b> — ele não sai da sua equipe
          nem fica preso em lugar nenhum.</li>
        </ul>

        ${nota(`<b>O nível conta inteiro até ${N(ARENA_NIVEL_CHEIO, c.lang)}, e comprimido daí
        para cima.</b> Não há teto: cada nível acima disso continua valendo, só que cada vez
        menos — nv 1.000 conta 352, nv 3.000 conta 578, nv 10.000 conta 993. Dobrar o nível
        rende sempre os mesmos <b>+37%</b>, em qualquer ponto da curva, então nenhum nível é
        desperdiçado. O nascimento e o refino voltam a decidir o pódio, e o grind continua
        pesando. (A <a data-cap="guild">Guerra de Guilds</a> comprime <b>mais</b> que o
        ginásio — são eventos diferentes.)`)}

        <h4>Como a força é medida</h4>
        <p>Não é o <b>⚔ do Ranking</b>. Aquele número mede o quanto um espécime é <b>raro e bem
        investido</b>; o pódio precisa responder outra pergunta: <b>quem ganharia a luta</b>. A
        força de cada pokémon é o produto do <b>dano por segundo</b> pelo <b>HP efetivo</b> — que
        é o que decide um duelo de desgaste —, e o time vale a soma dos cinco.</p>

        <h4>Desafiar o líder</h4>
        <p>O desafio é um <b>duelo simulado</b>: o seu time contra o dele, um de cada vez, com a
        mesma engine da <a data-cap="guild">Guerra de Guilds</a>. Ganhou, o ginásio é seu. Você
        assiste tudo no <b>replay</b>, com os golpes, os números de dano e as trocas de pokémon.</p>
        <ul>
          <li><b>${N(HORAS_DESAFIO_GINASIO, c.lang)} horas de espera</b> entre dois desafios ao <b>mesmo</b> ginásio.
          Os 18 relógios são independentes — perder em FIRE não trava o seu desafio em WATER.</li>
          <li>O bônus de líder <b>não vale dentro do duelo</b>: o líder não defende o ginásio
          batendo 25% mais forte por já ser o líder.</li>
        </ul>

        <h4>O prêmio</h4>
        <p>Enquanto você for o líder, todo pokémon seu <b>daquele tipo</b> bate
        <b>+${GINASIO_BUFF_PCT}%</b> na <a data-cap="mapa">hunt</a> — inclui
        <b>boss</b>. Não vale no duelo do ginásio, na
        <a data-cap="pvp">PvP Ranqueado</a> nem na <a data-cap="guild">Guerra de Guilds</a>.</p>
        <ul>
          <li>Vale para o <b>pokémon inteiro</b>, não para o golpe: o Charizard de quem lidera
          FIRE bate mais forte com Flamethrower <b>e</b> com Investida.</li>
          <li><b>Não empilha.</b> Liderar FIRE e FLYING não dá 56% ao Charizard — dá os mesmos
          ${GINASIO_BUFF_PCT}%.</li>
        </ul>`,
      en: `
        <p>There are <b>${N(TIPOS_GINASIO.length, c.lang)} gyms</b>, one per elemental type. Each
        has a <b>leaderboard</b> the whole server competes for: whoever sits in <b>1st</b> is the
        <b>leader</b> of that type — and leading pays <b>+${GINASIO_BUFF_PCT}% damage</b>.</p>

        <h4>The gym team</h4>
        <ul>
          <li>Up to <b>${N(GINASIO_TIME_MAX, c.lang)} pokémon</b>, and <b>all of the gym's
          type</b>. Dual types count for both: a Charizard works for <b>FIRE</b> and
          <b>FLYING</b>.</li>
          <li><b>No repeated species.</b> Five copies of the same good pokémon are not a team —
          the podium is for who built a team, not who farmed one species.</li>
          <li>Requires <b>trainer level ${N(GINASIO_NIVEL_MIN, c.lang)}</b> to register in any
          gym.</li>
          <li>A registered team <b>stays yours and stays playable</b> — it does not leave your
          party or get locked away.</li>
        </ul>

        ${nota(`<b>Level counts in full up to ${N(ARENA_NIVEL_CHEIO, c.lang)}, and compressed
        above that.</b> There is no cap: every level above it still counts, just less and less —
        lv 1,000 counts as 352, lv 3,000 as 578, lv 10,000 as 993. Doubling your level always
        pays the same <b>+37%</b>, anywhere on the curve, so no level is ever wasted. Birth stats
        and refining decide the podium again, and grinding still weighs. (The
        <a data-cap="guild">Guild War</a> compresses <b>harder</b> than the gyms — they are
        different events.)`)}

        <h4>How strength is measured</h4>
        <p>It is not the <b>⚔ from the Rankings</b>. That number measures how <b>rare and well
        invested</b> a specimen is; the podium answers a different question: <b>who would win the
        fight</b>. Each pokémon's strength is its <b>damage per second</b> times its <b>effective
        HP</b> — which is what decides a war of attrition — and the team is worth the sum of the
        five.</p>

        <h4>Challenging the leader</h4>
        <p>The challenge is a <b>simulated duel</b>: your team against theirs, one at a time, on
        the same engine as the <a data-cap="guild">Guild War</a>. Win and the gym is yours. You
        watch the whole thing in the <b>replay</b>, with the moves, the damage numbers and the
        pokémon swaps.</p>
        <ul>
          <li><b>${N(HORAS_DESAFIO_GINASIO, c.lang)} hours of cooldown</b> between two challenges to the <b>same</b>
          gym. All 18 clocks are independent — losing in FIRE does not lock your WATER
          challenge.</li>
          <li>The leader bonus <b>does not apply inside the duel</b>: the leader does not defend
          the gym hitting 25% harder for already being the leader.</li>
        </ul>

        <h4>The prize</h4>
        <p>While you are the leader, every pokémon of yours <b>of that type</b> hits
        <b>+${GINASIO_BUFF_PCT}%</b> in the <a data-cap="mapa">hunt</a> — including
        <b>bosses</b>. It does not apply in the gym duel, the
        <a data-cap="pvp">Ranked PvP</a> or the <a data-cap="guild">Guild War</a>.</p>
        <ul>
          <li>It applies to the <b>whole pokémon</b>, not to the move: the Charizard of a FIRE
          leader hits harder with Flamethrower <b>and</b> with Tackle.</li>
          <li><b>It does not stack.</b> Leading FIRE and FLYING does not give Charizard 56% — it
          gives the same ${GINASIO_BUFF_PCT}%.</li>
        </ul>`,
      es: `
        <p>Son <b>${N(TIPOS_GINASIO.length, c.lang)} gimnasios</b>, uno por cada tipo elemental.
        Cada uno tiene un <b>podio</b> disputado por todo el servidor: quien esté en <b>1º</b> es
        el <b>líder</b> de ese tipo — y liderar paga <b>+${GINASIO_BUFF_PCT}% de daño</b>.</p>

        <h4>El equipo del gimnasio</h4>
        <ul>
          <li>Hasta <b>${N(GINASIO_TIME_MAX, c.lang)} pokémon</b>, y <b>todos del tipo del
          gimnasio</b>. El tipo doble entra en los dos: un Charizard vale para <b>FIRE</b> y para
          <b>FLYING</b>.</li>
          <li><b>Sin especies repetidas.</b> Cinco copias del mismo bicho bueno no son un equipo —
          y el podio es de quien armó un equipo, no de quien farmeó una especie.</li>
          <li>Necesita <b>nivel ${N(GINASIO_NIVEL_MIN, c.lang)} de entrenador</b> para registrar
          en cualquier gimnasio.</li>
          <li>El equipo registrado <b>sigue siendo tuyo y sigue jugable</b> — no sale de tu equipo
          ni queda encerrado en ningún lado.</li>
        </ul>

        ${nota(`<b>El nivel cuenta entero hasta ${N(ARENA_NIVEL_CHEIO, c.lang)}, y comprimido de
        ahí en adelante.</b> No hay techo: cada nivel por encima sigue valiendo, solo que cada vez
        menos — nv 1.000 cuenta 352, nv 3.000 cuenta 578, nv 10.000 cuenta 993. Duplicar el nivel
        rinde siempre el mismo <b>+37%</b>, en cualquier punto de la curva, así que ningún nivel
        se desperdicia. El nacimiento y el refinado vuelven a decidir el podio, y el grind sigue
        pesando. (La <a data-cap="guild">Guerra de Guilds</a> comprime <b>más</b> que el
        gimnasio — son eventos distintos.)`)}

        <h4>Cómo se mide la fuerza</h4>
        <p>No es el <b>⚔ de la Clasificación</b>. Ese número mide cuán <b>raro y bien invertido</b>
        es un ejemplar; el podio responde otra pregunta: <b>quién ganaría la pelea</b>. La fuerza
        de cada pokémon es su <b>daño por segundo</b> por su <b>HP efectivo</b> — que es lo que
        decide un duelo de desgaste —, y el equipo vale la suma de los cinco.</p>

        <h4>Desafiar al líder</h4>
        <p>El desafío es un <b>duelo simulado</b>: tu equipo contra el suyo, uno a la vez, con el
        mismo motor de la <a data-cap="guild">Guerra de Guilds</a>. Si ganas, el gimnasio es tuyo.
        Lo ves todo en el <b>replay</b>, con los golpes, los números de daño y los cambios de
        pokémon.</p>
        <ul>
          <li><b>${N(HORAS_DESAFIO_GINASIO, c.lang)} horas de espera</b> entre dos desafíos al <b>mismo</b> gimnasio.
          Los 18 relojes son independientes — perder en FIRE no bloquea tu desafío en WATER.</li>
          <li>El bono de líder <b>no vale dentro del duelo</b>: el líder no defiende el gimnasio
          pegando 25% más fuerte por ya ser el líder.</li>
        </ul>

        <h4>El premio</h4>
        <p>Mientras seas el líder, todo pokémon tuyo <b>de ese tipo</b> pega
        <b>+${GINASIO_BUFF_PCT}%</b> en la <a data-cap="mapa">cacería</a> — incluye
        <b>bosses</b>. No vale en el duelo del gimnasio, en el
        <a data-cap="pvp">PvP Clasificatorio</a> ni en la <a data-cap="guild">Guerra de Guilds</a>.</p>
        <ul>
          <li>Vale para el <b>pokémon entero</b>, no para el golpe: el Charizard de quien lidera
          FIRE pega más fuerte con Flamethrower <b>y</b> con Placaje.</li>
          <li><b>No se acumula.</b> Liderar FIRE y FLYING no da 56% al Charizard — da los mismos
          ${GINASIO_BUFF_PCT}%.</li>
        </ul>`,
    }),
  },

  // ------------------------------------------------------------ 15. ranking
  {
    id: 'ranking',
    titulo: { pt: 'Ranking', en: 'Rankings', es: 'Clasificación' },
    grupo: 'mundo',
    html: (c) => ({
      pt: `
        <p>O placar do mundo inteiro, não do seu servidor. Oito abas:</p>
        ${tabela(
          ['Aba', 'O que ordena'],
          `<tr><td>Treinadores</td><td>nível do treinador (desempate por XP)</td></tr>
           <tr><td>Pokémon Forte</td><td>o <b>poder</b> de um pokémon, de qualquer treinador</td></tr>
           <tr><td>Top Catch</td><td><b>espécies diferentes</b> já capturadas, não capturas totais</td></tr>
           <tr><td>Top Coins</td><td>ouro acumulado na conta</td></tr>
           <tr><td>PvP Ranqueado</td><td>o rank e o PR (ver <a data-cap="pvp">PvP Ranqueado</a>)</td></tr>
           <tr><td>Bosses</td><td>vitórias contra o boss que você escolher na aba</td></tr>
           <tr><td>Guild Diário</td><td>GP da guild, que dá o bônus de XP e loot (ver <a data-cap="guild">Guilds</a>)</td></tr>
           <tr><td>Guild Global</td><td>GP somado das guerras do mês, com prêmio em diamantes; zera todo mês</td></tr>`,
        )}
        <p>Clicar num nome abre o perfil público do treinador — stats, Pokédex, o rank do PvP
        Ranqueado e a equipe dele no PvP, sem dados de conta. O mesmo perfil abre pelo chat e pela
        lista de amigos.</p>

        <h4>Pokémon Forte — como o ⚔ é calculado</h4>
        <p>Usa a <b>mesma força de nascimento</b> da calculadora (soma dos seis stats, normalizada),
        mas multiplica pelo <b>nível</b> do pokémon. Treinar sobe no placar; a nota da
        calculadora não. Detalhes em
        <a data-cap="nota">Nota, Poder e Calculadora</a>.</p>
        <pre class="wk-formula">score = mesma força da nota (0–1)
poder = arred( nível × 10 × score )</pre>
        <p>A aba mostra essa fórmula no topo do placar.</p>

        ${nota(`O placar sai do banco, não da memória do jogo: o que você vê pode estar até
        <b>5 segundos</b> atrasado. Para um ranking, é irrelevante.`)}`,
      en: `
        <p>The world-wide ladder, not your server's. Eight tabs:</p>
        ${tabela(
          ['Tab', 'What it sorts by'],
          `<tr><td>Trainers</td><td>trainer level (XP breaks ties)</td></tr>
           <tr><td>Strongest Pokémon</td><td>a pokémon's <b>power</b>, from any trainer</td></tr>
           <tr><td>Top Catch</td><td><b>distinct species</b> caught, not total catches</td></tr>
           <tr><td>Top Coins</td><td>gold held</td></tr>
           <tr><td>Ranked PvP</td><td>rank and PR (see <a data-cap="pvp">Ranked PvP</a>)</td></tr>
           <tr><td>Bosses</td><td>wins against the boss you pick in the tab</td></tr>
           <tr><td>Guild Daily</td><td>guild GP, which grants the XP and loot bonus (see <a data-cap="guild">Guilds</a>)</td></tr>
           <tr><td>Guild Global</td><td>GP added up from the month's wars, with a diamond prize; resets every month</td></tr>`,
        )}
        <p>Clicking a name opens that trainer's public profile — stats, Pokédex progress, their
        Ranked PvP rank and PvP team, without account details. The same profile opens from the
        chat and the friends list.</p>

        <h4>Strongest Pokémon — how ⚔ is calculated</h4>
        <p>Uses the <b>same birth strength</b> as the calculator (sum of six stats, normalized),
        but multiplies by the pokémon's <b>level</b>. Training raises the ladder score; the
        calculator score does not. Full detail in
        <a data-cap="nota">Score, Power and Calculator</a>.</p>
        <pre class="wk-formula">score = same strength as the calculator (0–1)
power = round( level × 10 × score )</pre>
        <p>The tab shows this formula at the top of the ladder.</p>

        ${nota(`The ladder comes from the database, not from live memory: what you see may be up to
        <b>5 seconds</b> behind. For a ranking, that is irrelevant.`)}`,
      es: `
        <p>La clasificación del mundo entero, no de tu servidor. Ocho pestañas:</p>
        ${tabela(
          ['Pestaña', 'Qué ordena'],
          `<tr><td>Entrenadores</td><td>nivel del entrenador (desempata el XP)</td></tr>
           <tr><td>Pokémon Fuerte</td><td>el <b>poder</b> de un pokémon, de cualquier entrenador</td></tr>
           <tr><td>Top Captura</td><td><b>especies distintas</b> capturadas, no capturas totales</td></tr>
           <tr><td>Top Coins</td><td>oro acumulado</td></tr>
           <tr><td>PvP Clasificatorio</td><td>el rango y los PR del PvP Clasificatorio (ver <a data-cap="pvp">PvP Clasificatorio</a>)</td></tr>
           <tr><td>Jefes</td><td>victorias contra el jefe que elijas en la pestaña</td></tr>
           <tr><td>Guild Diaria</td><td>GP de la guild, que da el bonus de XP y loot (ver <a data-cap="guild">Guilds</a>)</td></tr>
           <tr><td>Guild Global</td><td>GP sumado de las guerras del mes, con premio en diamantes; se reinicia cada mes</td></tr>`,
        )}
        <p>Hacer clic en un nombre abre el perfil público del entrenador — stats, progreso de
        Pokédex, el rango del PvP Clasificatorio y su equipo de PvP, sin datos de cuenta. El mismo
        perfil se abre desde el chat y la lista de amigos.</p>

        <h4>Pokémon Fuerte — cómo se calcula el ⚔</h4>
        <p>Usa la <b>misma fuerza al nacer</b> que la calculadora (suma de los seis stats,
        normalizada), pero multiplica por el <b>nivel</b> del pokémon. Entrenar sube en el placar;
        la nota de la calculadora no. Detalle en
        <a data-cap="nota">Nota, Poder y Calculadora</a>.</p>
        <pre class="wk-formula">score = misma fuerza que la nota (0–1)
poder = redond( nivel × 10 × score )</pre>
        <p>La pestaña muestra esta fórmula arriba del placar.</p>

        ${nota(`La clasificación sale de la base de datos, no de la memoria del juego: lo que ves
        puede estar hasta <b>5 segundos</b> atrasado. Para un ranking, es irrelevante.`)}`,
    }),
  },

  // ------------------------------------------------------------- 15. market
  {
    id: 'market',
    titulo: { pt: 'Market (o NPC)', en: 'Market (the NPC)', es: 'Market (el NPC)' },
    grupo: 'economia',
    html: (c) => ({
      pt: `
        <p>O balcão do jogo. Compra e venda com o <b>NPC</b>, em <b>ouro</b>, sem taxa nenhuma e
        em quantidade ilimitada. Três abas.</p>

        <h4>Compra</h4>
        <ul>
          <li><b>Pokébolas</b> — as compráveis, aos preços da <a data-cap="captura">tabela</a>.</li>
          <li><b>Poções</b> e <b>Revives</b> — todas as variantes, ao preço de catálogo.</li>
          <li><b>Caixas</b> — um prêmio sorteado por caixa (ver
          <a data-cap="caixas">Caixas do Market</a>).</li>
        </ul>
        <p>O <b>Bronze Boss Token</b> (entrada de <a data-cap="bosses">boss</a>) <b>não</b> se
        compra aqui — é drop raro na Outland (${pctBossToken(c)} por kill) e prêmio das Caixas.${dicaOutlandTiers(c, 'bosses')}</p>

        <h4>Venda</h4>
        <p>Tudo que os pokémon dropam, pelo valor de catálogo (<b>100%</b> do preço de NPC — não
        há desconto). Há um botão de <b>vender tudo</b> para o inventário inteiro.</p>
        ${nota(`<b>Consumível que o NPC vende, o NPC não recompra.</b> Poção e revive entram nessa
        regra. O Bronze Boss Token também <b>não</b> pode ser vendido ao NPC — anuncie no
        <a data-cap="comunidade">Mercado da Comunidade</a> se quiser passar adiante.`, 'aviso')}
        <p>Bola e poção sobrando na bolsa? A <b>Lixeira</b>, na aba <b>Treinador</b> da Bolsa, joga
        fora a quantidade que você escolher (ou <b>Tudo</b>). Ela só aceita bolas, poções e
        revives, e o que vai para ela <b>some para sempre</b> — não há como desfazer.</p>

        <h4>Venda de Pokémon</h4>
        <pre class="wk-formula">preço = valorBase × (1 + nível/50) × qualidade × (shiny ? 10 : 1)</pre>
        <ul>
          <li>O <b>valorBase</b> é o da espécie, do catálogo.</li>
          <li>Nível e qualidade valorizam; <b>shiny vale 10×</b>.</li>
          <li>Repare que a <b>potência não entra</b> nesta conta — o NPC não paga por ela. Um P4 ou
          P5 vale muito mais no <a data-cap="comunidade">Mercado da Comunidade</a>, com outro
          jogador.</li>
        </ul>
        <p>O <b>Ordenar por</b> da lista arruma por nível, qualidade, potência, nota da
        calculadora, <b>Maior IV Total</b> (a soma dos seis IVs), cada IV separado, tipo ou
        captura mais recente. A mesma lista serve à escolha da <a data-cap="oferenda">Oferenda</a>
        e ao anexo do chat.</p>
        <p>Não dá para vender quem está lutando, nem o último pokémon. "Vender todo o Depot" nunca
        toca em quem está na equipe.</p>

        <h4>A Coleção</h4>
        <p>Os pokémon que você quer <b>guardar</b> vão para a <b>Coleção</b>: eles saem desta lista
        e do "vender todo o Depot", e o NPC não os compra.</p>
        <ul>
          <li>A <b>setinha</b> no canto do card manda o pokémon para a Coleção. No Depot (Centro
          de Cerulean), os guardados têm duas abas, <b>Depot</b> e <b>Coleção</b>, e a mesma
          setinha leva de uma para a outra. A Coleção também abre de qualquer lugar, na aba
          <b>Coleção</b> da Bolsa.</li>
          <li>Mover não troca o pokémon de lugar nenhum: é uma marca. Ele continua valendo no
          <a data-cap="comunidade">Mercado da Comunidade</a>, na
          <a data-cap="oferenda">Oferenda</a> e nas equipes, com uma <b>★</b>. Nesses seletores, o
          filtro <b>Local</b> mostra só a Equipe, o Depot ou a Coleção.</li>
          <li>Cada pokémon espera alguns segundos antes de mudar de lado de novo.</li>
          <li><b>Auto Coleção</b> manda sozinho para a Coleção os shinys, os P5 e quem tem nota
          a partir da que você escolher (interruptores ao lado do "vender todo"). Pokémon
          comprado no Mercado da Comunidade e pokémon refinado também chegam na Coleção.</li>
        </ul>`,
      en: `
        <p>The game's counter. Buying and selling with the <b>NPC</b>, in <b>gold</b>, with no fee
        whatsoever and in unlimited quantity. Three tabs.</p>

        <h4>Buy</h4>
        <ul>
          <li><b>Poké Balls</b> — the purchasable ones, at the <a data-cap="captura">table</a>
          prices.</li>
          <li><b>Potions</b> and <b>Revives</b> — every variant, at catalogue price.</li>
          <li><b>Boxes</b> — one prize drawn per box (see
          <a data-cap="caixas">Market Boxes</a>).</li>
        </ul>
        <p>The <b>Bronze Boss Token</b> is <b>not</b> sold here — it is a rare Outland drop (${pctBossToken(c)} per kill) and a Box prize.${dicaOutlandTiers(c, 'bosses')}</p>

        <h4>Sell</h4>
        <p>Everything pokémon drop, at catalogue value (<b>100%</b> of the NPC price — no
        discount). There is a <b>sell all</b> button for the whole inventory.</p>
        ${nota(`<b>What the NPC sells, the NPC does not buy back.</b> Potions and revives follow
        that rule. The Bronze Boss Token also <b>cannot</b> be sold to the NPC — list it on the
        <a data-cap="comunidade">Community Market</a> instead.`, 'aviso')}
        <p>Too many balls and potions in the bag? The <b>Trash</b>, on the Bag's <b>Trainer</b> tab,
        throws away the amount you choose (or <b>All</b>). It only takes balls, potions and
        revives, and whatever goes in is <b>gone for good</b> — there is no undo.</p>

        <h4>Selling Pokémon</h4>
        <pre class="wk-formula">price = baseValue × (1 + level/50) × quality × (shiny ? 10 : 1)</pre>
        <ul>
          <li><b>baseValue</b> is the species', from the catalogue.</li>
          <li>Level and quality add value; <b>shiny is worth 10×</b>.</li>
          <li>Note that <b>potency does not enter</b> this formula — the NPC does not pay for it. A
          P4 or P5 is worth far more on the <a data-cap="comunidade">Community Market</a>, to
          another player.</li>
        </ul>
        <p>The list's <b>Sort by</b> orders by level, quality, potency, calculator score,
        <b>Highest Total IV</b> (the sum of the six IVs), each IV on its own, type or most recent
        catch. The same list powers the <a data-cap="oferenda">Offering</a> picker and the chat
        attachment.</p>
        <p>You cannot sell whoever is fighting, nor your last pokémon. "Sell the whole Depot" never
        touches anyone on the team.</p>

        <h4>The Collection</h4>
        <p>The pokémon you want to <b>keep</b> go to your <b>Collection</b>: they leave this list
        and "sell the whole Depot", and the NPC does not buy them.</p>
        <ul>
          <li>The <b>arrow</b> in the card's corner sends a pokémon to the Collection. In the
          Depot (Cerulean Center), stored pokémon have two tabs, <b>Depot</b> and
          <b>Collection</b>, and the same arrow moves them across. The Collection also opens from
          anywhere, in the Bag's <b>Collection</b> tab.</li>
          <li>Moving does not take the pokémon anywhere: it is a mark. It still counts on the
          <a data-cap="comunidade">Community Market</a>, in the
          <a data-cap="oferenda">Offering</a> and on your teams, with a <b>★</b>. In those pickers
          the <b>Location</b> filter shows only the Team, the Depot or the Collection.</li>
          <li>Each pokémon waits a few seconds before it can switch sides again.</li>
          <li><b>Auto Collection</b> sends shinies, P5s and anything at or above the score you pick
          straight to the Collection (switches next to "sell all"). Pokémon bought on the
          Community Market and refined pokémon also land in the Collection.</li>
        </ul>`,
      es: `
        <p>El mostrador del juego. Compra y venta con el <b>NPC</b>, en <b>oro</b>, sin comisión
        alguna y en cantidad ilimitada. Tres pestañas.</p>

        <h4>Compra</h4>
        <ul>
          <li><b>Poké Balls</b> — las comprables, a los precios de la
          <a data-cap="captura">tabla</a>.</li>
          <li><b>Pociones</b> y <b>Revivires</b> — todas las variantes, a precio de catálogo.</li>
          <li><b>Cajas</b> — un premio sorteado por caja (ver
          <a data-cap="caixas">Cajas del Market</a>).</li>
        </ul>
        <p>El <b>Bronze Boss Token</b> <b>no</b> se compra aquí — es drop raro en Outland (${pctBossToken(c)} por kill) y premio de las Cajas.${dicaOutlandTiers(c, 'bosses')}</p>

        <h4>Venta</h4>
        <p>Todo lo que sueltan los pokémon, al valor de catálogo (<b>100%</b> del precio de NPC —
        sin descuento). Hay un botón de <b>vender todo</b> para el inventario entero.</p>
        ${nota(`<b>Lo que el NPC vende, el NPC no recompra.</b> Pociones y revivires entran en esa
        regla. El Bronze Boss Token tampoco se vende al NPC — anúncialo en el
        <a data-cap="comunidade">Mercado de la Comunidad</a>.`, 'aviso')}
        <p>¿Te sobran balls y pociones en la bolsa? La <b>Papelera</b>, en la pestaña
        <b>Entrenador</b> de la Bolsa, tira la cantidad que elijas (o <b>Todo</b>). Solo acepta
        balls, pociones y revivires, y lo que va a ella <b>desaparece para siempre</b> — no se
        puede deshacer.</p>

        <h4>Venta de Pokémon</h4>
        <pre class="wk-formula">precio = valorBase × (1 + nivel/50) × calidad × (shiny ? 10 : 1)</pre>
        <ul>
          <li>El <b>valorBase</b> es el de la especie, del catálogo.</li>
          <li>Nivel y calidad revalorizan; <b>shiny vale 10×</b>.</li>
          <li>Fíjate en que la <b>potencia no entra</b> en esta cuenta — el NPC no la paga. Un P4 o
          P5 vale mucho más en el <a data-cap="comunidade">Mercado de la Comunidad</a>, con otro
          jugador.</li>
        </ul>
        <p>El <b>Ordenar por</b> de la lista ordena por nivel, calidad, potencia, nota de la
        calculadora, <b>Mayor IV Total</b> (la suma de los seis IV), cada IV por separado, tipo o
        captura más reciente. La misma lista sirve a la selección de la
        <a data-cap="oferenda">Ofrenda</a> y al adjunto del chat.</p>
        <p>No se puede vender a quien está peleando ni al último pokémon. "Vender todo el Depot"
        nunca toca a los del equipo.</p>

        <h4>La Colección</h4>
        <p>Los pokémon que quieres <b>guardar</b> van a la <b>Colección</b>: salen de esta lista y
        de "vender todo el Depot", y el NPC no los compra.</p>
        <ul>
          <li>La <b>flechita</b> en la esquina de la tarjeta envía el pokémon a la Colección. En el
          Depósito (Centro de Cerulean), los guardados tienen dos pestañas, <b>Depósito</b> y
          <b>Colección</b>, y la misma flechita los pasa de una a otra. La Colección también se
          abre desde cualquier lugar, en la pestaña <b>Colección</b> de la Bolsa.</li>
          <li>Mover no cambia el pokémon de lugar: es una marca. Sigue valiendo en el
          <a data-cap="comunidade">Mercado de la Comunidad</a>, en la
          <a data-cap="oferenda">Ofrenda</a> y en los equipos, con una <b>★</b>. En esos
          selectores, el filtro <b>Ubicación</b> muestra solo el Equipo, el Depósito o la
          Colección.</li>
          <li>Cada pokémon espera unos segundos antes de cambiar de lado otra vez.</li>
          <li><b>Auto Colección</b> envía sola a la Colección los shinys, los P5 y los que tengan
          nota desde la que elijas (interruptores junto a "vender todo"). Los pokémon comprados en
          el Mercado de la Comunidad y los refinados también llegan a la Colección.</li>
        </ul>`,
    }),
  },

  // --------------------------------------------------------- 16. comunidade
  // ------------------------------------------------------- o ralo de Coins
  {
    id: 'caixas',
    titulo: { pt: 'Caixas do Market', en: 'Market Boxes', es: 'Cajas del Market' },
    grupo: 'economia',
    html: (c) => {
      const nomes = { pt: ['Caixa Free', 'Caixa Diamante VIP'], en: ['Free Box', 'VIP Diamond Box'], es: ['Caja Free', 'Caja Diamante VIP'] };
      const nomeCx = (i) => (nomes[c.lang] ?? nomes.pt)[i];
      const sim = { pt: 'todo mundo', en: 'everyone', es: 'todos' }[c.lang] ?? 'todo mundo';
      const soVip = { pt: 'só VIP ativo', en: 'active VIP only', es: 'solo VIP activo' }[c.lang] ?? 'só VIP ativo';
      // A tabela das duas caixas, montada da regra: preço, diamante e multiplicador das raras.
      const caixas = CAIXAS.map((cx, i) => `
        <tr>
          <td><b>${nomeCx(i)}</b></td>
          <td>${N(cx.coins, c.lang)}</td>
          <td>${cx.diamantes ? N(cx.diamantes, c.lang) : '—'}</td>
          <td>×${N(cx.mult, c.lang)}</td>
          <td>${cx.vip ? soVip : sim}</td>
        </tr>`).join('');

      // O CONTEÚDO: toda linha das duas caixas, lado a lado, na ordem lendário → raro → comum.
      // As duas colunas juntas mostram, sem explicação, o que os diamantes da VIP compram.
      const rotuloTier = {
        pt: { lendario: 'Lendário', raro: 'Raro', comum: 'Comum' },
        en: { lendario: 'Legendary', raro: 'Rare', comum: 'Common' },
        es: { lendario: 'Legendario', raro: 'Raro', comum: 'Común' },
      }[c.lang] ?? { lendario: 'Lendário', raro: 'Raro', comum: 'Comum' };
      const free = conteudoDaCaixa('free');
      const vip = conteudoDaCaixa('vip');

      // Os números do texto saem da regra, e não da mão: com o preço escrito por extenso, a troca
      // de 1 para 5 milhões deixou "3 bilhões abrem 3.000 caixas" mentindo (eram 600).
      const [cxFree, cxVip] = CAIXAS;
      const chanceNaFree = (id) => free.find((l) => l.id === id)?.chance || 1;
      const coinsPorFrag = cxFree.coins / chanceNaFree(FRAG_CHAVE_ID);
      const coinsPorToken = cxFree.coins / chanceNaFree(BOSS_TOKEN_ID);
      const caixasCom3Bi = Math.floor(3e9 / cxFree.coins);
      /** "3,75 bilhões" / "3.75 billion" / "3,75 mil millones" — o número grande, por extenso. */
      const grande = (n) => {
        const L = c.lang;
        const bi = N(Math.round(n / 1e7) / 100, L);
        const mi = N(Math.round(n / 1e5) / 10, L);
        if (L === 'en') return n >= 1e9 ? `${bi} billion` : `${mi} million`;
        if (L === 'es') return n >= 1e9 ? `${bi} mil millones` : `${mi} millones`;
        return n >= 1e9 ? `${bi} bilhões` : `${mi} milhões`;
      };
      const conteudo = [TIER_LENDARIO, TIER_RARO, TIER_COMUM].flatMap((tier) =>
        free.map((linha, i) => ({ linha, vip: vip[i], tier })).filter((x) => x.linha.tier === tier))
        .map(({ linha, vip: v, tier }) => `
        <tr>
          <td>${nomePremioWiki(linha, c)}</td>
          <td>${rotuloTier[tier]}</td>
          <td>${pctCaixa(linha.chance, c.lang)}</td>
          <td>${pctCaixa(v.chance, c.lang)}</td>
        </tr>`).join('');

      return {
        pt: `
        <p><b>As caixas existem para queimar Coins.</b> Ouro parado não vale nada, e a caixa é o
        lugar onde ele vira sorte: você paga, ela sorteia, e o que sai são <b>itens</b> — nunca
        Coin, diamante ou gema de volta.</p>

        <p>Ficam no <a data-cap="market">Market</a>, na aba <b>Comprar</b>, categoria
        <b>Caixas</b>.</p>

        <h4>As duas caixas</h4>
        <table class="wk-tab">
          <thead><tr><th>Caixa</th><th>Coins</th><th>Diamantes</th><th>Chances raras</th><th>Quem abre</th></tr></thead>
          <tbody>${caixas}</tbody>
        </table>
        <p>A <b>${nomeCx(1)}</b> cobra <b>${N(cxVip.coins, c.lang)} Coins e mais ${N(cxVip.diamantes, c.lang)} diamantes</b>, e é <b>só para quem tem
        VIP ativo</b>. Em troca, <b>dobra a chance de tudo que é raro e lendário</b> — o que cresce
        em cima encolhe nos comuns, sozinho. É o único benefício dela: não existe item que só saia
        na VIP.</p>

        <h4>Sai UM prêmio por caixa</h4>
        <p>Cada caixa aberta dá <b>uma coisa</b>, e todas as coisas dividem os mesmos 100%. A
        porcentagem ao lado de cada linha da tabela abaixo é <b>a chance dela sair</b>, sem letra
        miúda. Quem quer abrir várias escolhe a quantidade no contador do card: são <b>N caixas</b>,
        cada uma com o seu sorteio, N vezes o preço.</p>
        <p>O botão <b>Máx</b> enche com <b>quantas caixas o seu saldo paga</b> — o mesmo teto que o
        resto do Market usa. Quem tem 3 bilhões de Coins abre <b>${N(caixasCom3Bi, c.lang)} de uma vez</b>, e o resultado
        vem <b>agrupado</b>: "Poké Ball ×60.000 · saiu 12×" quer dizer que 12 das suas caixas deram
        Poké Ball.</p>

        <h4>Tudo o que pode sair</h4>
        <table class="wk-tab">
          <thead><tr><th>Prêmio</th><th>Raridade</th><th>${nomeCx(0)}</th><th>${nomeCx(1)}</th></tr></thead>
          <tbody>${conteudo}</tbody>
        </table>
        <p>Esta é a mesma tabela que o servidor sorteia, e ela está na tela no botão
        <b>"Ver Conteúdo"</b> de cada caixa, antes do clique.</p>

        <h4>É caro de propósito</h4>
        <p>Farmar um <b>Bronze Boss Token</b> custa cerca de 2.000 abates na Outland; a caixa cobra
        várias vezes isso em Coins. Os <b>fragmentos</b> (Chave, Shiny Stone, Bicicleta) e o
        <b>Bronze Boss Token</b> são o prêmio grande — um fragmento sai, em média, a cada <b>${grande(coinsPorFrag)}
        de Coins</b> na ${nomeCx(0)}, e um token a cada <b>${grande(coinsPorToken)}</b>. A caixa vende <b>sorte e tempo</b>, não um atalho barato: em
        média ela devolve menos do que cobra, e é essa diferença que queima o ouro do servidor.</p>

        ${nota(`<b>Nada volta em dinheiro.</b> Nenhuma caixa devolve Coin, diamante ou gema — se
        devolvesse, ela deixaria de ser um ralo e viraria uma torneira.`, 'perigo')}`,
        en: `
        <p><b>Boxes exist to burn Coins.</b> Idle gold is worth nothing, and the box is where it
        turns into luck: you pay, it rolls, and what comes out are <b>items</b> — never Coins,
        diamonds or gems back.</p>

        <p>They live in the <a data-cap="market">Market</a>, <b>Buy</b> tab, <b>Boxes</b>
        category.</p>

        <h4>The two boxes</h4>
        <table class="wk-tab">
          <thead><tr><th>Box</th><th>Coins</th><th>Diamonds</th><th>Rare odds</th><th>Who can open</th></tr></thead>
          <tbody>${caixas}</tbody>
        </table>
        <p>The <b>${nomeCx(1)}</b> charges <b>${N(cxVip.coins, c.lang)} Coins plus ${N(cxVip.diamantes, c.lang)} diamonds</b>, and is <b>only for
        players with active VIP</b>. In exchange it <b>doubles the odds of everything rare and
        legendary</b> — what grows at the top shrinks among the commons, on its own. That is its
        only perk: no item drops exclusively from it.</p>

        <h4>ONE prize per box</h4>
        <p>Each box opened gives <b>one thing</b>, and all things share the same 100%. The
        percentage next to each row below is <b>the chance it comes out</b>, no fine print. To open
        several, use the counter on the card: that is <b>N boxes</b>, each with its own roll, at N
        times the price.</p>
        <p>The <b>Max</b> button fills in <b>as many boxes as your balance pays for</b> — the same
        ceiling the rest of the Market uses. With 3 billion Coins that is <b>${N(caixasCom3Bi, c.lang)} in one click</b>,
        and the result comes <b>grouped</b>: "Poké Ball ×60,000 · came up 12×" means 12 of your
        boxes gave Poké Balls.</p>

        <h4>Everything that can come out</h4>
        <table class="wk-tab">
          <thead><tr><th>Prize</th><th>Rarity</th><th>${nomeCx(0)}</th><th>${nomeCx(1)}</th></tr></thead>
          <tbody>${conteudo}</tbody>
        </table>
        <p>This is the same table the server rolls, and it is on screen under each box's
        <b>"See Contents"</b> button, before the click.</p>

        <h4>Expensive on purpose</h4>
        <p>Farming a <b>Bronze Boss Token</b> costs around 2,000 Outland kills; the box charges
        several times that in Coins. <b>Fragments</b> (Key, Shiny Stone, Bicycle) and the <b>Bronze
        Boss Token</b> are the jackpot — a fragment comes out, on average, every <b>${grande(coinsPorFrag)}
        Coins</b> in the ${nomeCx(0)}, and a token every <b>${grande(coinsPorToken)}</b>. The box sells <b>luck and time</b>, not a cheap shortcut: on
        average it gives back less than it charges, and that difference is what burns the server's
        gold.</p>

        ${nota(`<b>Nothing comes back as money.</b> No box returns Coins, diamonds or gems — if it
        did, it would stop being a drain and become a tap.`, 'perigo')}`,
        es: `
        <p><b>Las cajas existen para quemar Coins.</b> El oro parado no vale nada, y la caja es
        donde se convierte en suerte: pagas, ella sortea, y lo que sale son <b>objetos</b> — nunca
        Coins, diamantes o gemas de vuelta.</p>

        <p>Están en el <a data-cap="market">Market</a>, pestaña <b>Comprar</b>, categoría
        <b>Cajas</b>.</p>

        <h4>Las dos cajas</h4>
        <table class="wk-tab">
          <thead><tr><th>Caja</th><th>Coins</th><th>Diamantes</th><th>Probabilidades raras</th><th>Quién abre</th></tr></thead>
          <tbody>${caixas}</tbody>
        </table>
        <p>La <b>${nomeCx(1)}</b> cobra <b>${N(cxVip.coins, c.lang)} Coins más ${N(cxVip.diamantes, c.lang)} diamantes</b> y es <b>solo para quien tiene
        VIP activo</b>. A cambio <b>duplica la probabilidad de todo lo raro y legendario</b> — lo
        que crece arriba encoge en los comunes, solo. Es su único beneficio: no hay objeto que
        salga únicamente en ella.</p>

        <h4>Sale UN premio por caja</h4>
        <p>Cada caja abierta da <b>una cosa</b>, y todas las cosas reparten el mismo 100%. El
        porcentaje al lado de cada fila de abajo es <b>la probabilidad de que salga</b>, sin letra
        pequeña. Para abrir varias, usa el contador de la tarjeta: son <b>N cajas</b>, cada una con
        su sorteo, a N veces el precio.</p>
        <p>El botón <b>Máx</b> llena con <b>cuántas cajas paga tu saldo</b> — el mismo tope que usa
        el resto del Market. Con 3 mil millones de Coins son <b>${N(caixasCom3Bi, c.lang)} de una vez</b>, y el resultado
        llega <b>agrupado</b>: "Poké Ball ×60.000 · salió 12×" significa que 12 de tus cajas dieron
        Poké Ball.</p>

        <h4>Todo lo que puede salir</h4>
        <table class="wk-tab">
          <thead><tr><th>Premio</th><th>Rareza</th><th>${nomeCx(0)}</th><th>${nomeCx(1)}</th></tr></thead>
          <tbody>${conteudo}</tbody>
        </table>
        <p>Es la misma tabla que el servidor sortea, y está en pantalla en el botón
        <b>"Ver Contenido"</b> de cada caja, antes del clic.</p>

        <h4>Es caro a propósito</h4>
        <p>Farmear un <b>Bronze Boss Token</b> cuesta unos 2.000 derribos en la Outland; la caja
        cobra varias veces eso en Coins. Los <b>fragmentos</b> (Llave, Shiny Stone, Bicicleta) y
        el <b>Bronze Boss Token</b> son el premio grande — un fragmento sale, en promedio, cada
        <b>${grande(coinsPorFrag)} de Coins</b> en la ${nomeCx(0)}. La caja vende <b>suerte y tiempo</b>, no
        un atajo barato.</p>

        ${nota(`<b>Nada vuelve como dinero.</b> Ninguna caja devuelve Coins, diamantes ni gemas.`, 'perigo')}`,
      };
    },
  },
  {
    id: 'comunidade',
    titulo: { pt: 'Mercado da Comunidade', en: 'Community Market', es: 'Mercado de la Comunidad' },
    grupo: 'economia',
    html: (c) => {
      const e = c.d.economia ?? {};
      const m = c.d.mercado ?? {};
      return {
        pt: `
        <p>Aqui quem está do outro lado do balcão é <b>outro jogador</b>. Você anuncia pokémon,
        itens e <b>diamantes comprados</b>, e cobra em <b>Ouro</b> ou em <b>Gema</b> — a moeda com
        lastro em USDT (ver <a data-cap="gemas">Gemas</a>).</p>

        <h4>Anunciar</h4>
        <ul>
          <li>Anunciar <b>tira da sua mão</b>: o item sai da bolsa e o pokémon sai do depot na
          hora. Cancelar devolve.</li>
          <li>Você pode ter até <b>${e.maxAnuncios ?? 20} anúncios abertos</b> ao mesmo tempo.</li>
          <li><b>Um anúncio por item</b>: enquanto o seu Water Stone estiver na vitrine, não dá
          para abrir um segundo por outro preço — mude o preço do que já está lá. Quando ele
          sair (vendido ou cancelado), são <b>${m.reanuncioMin ?? 30} minutos</b> até você poder
          anunciar o mesmo item de novo. É o que impede uma escada de "o mesmo item por um Coin
          a menos" tomar a lista inteira.</li>
          <li><b>Só entra item com valor de troca</b>: <b>pedras de evolução</b> (as
          <b>Shiny Stones</b> inclusive), <b>discos e peças de TM</b>, o <b>Bronze Boss Token</b>,
          os <b>fragmentos</b> (de Chave, de Shiny Stone e de Bicicleta), <b>casas</b>,
          <b>bicicletas</b>, as <b>Caixas de Fundador</b> e a <b>Beast Ball</b>. Drop de pokémon
          (Bug Wing, Fur, Fossil…) não vai à vitrine — eram centenas de itens de mil moedas
          enterrando o que a pessoa foi procurar.</li>
          <li><b>Pokémon precisa passar na faixa mínima</b>: <b>nível ${m.pokemonMin?.level ?? 50}+</b> e
          <b>nota ${m.pokemonMin?.nota ?? 3.0}+</b> na calculadora (força de nascimento — IV,
          qualidade, potência e shiny). <b>Shiny e P5</b> entram em qualquer nível/nota.</li>
          <li>O preço é <b>por unidade</b>. Um lote de 100 Water Stone pode ser comprado em
          fatias.</li>
        </ul>

        <h4>Comprar</h4>
        <p>Todo pokémon comprado aqui <b>chega na sua Coleção</b>, fora da venda ao NPC, para ele
        não ir embora num "vender todo o depot" do <a data-cap="market">Market</a>. Devolva ao
        Depot se quiser mesmo revendê-lo ao NPC.</p>
        <ul>
          <li>A <b>★</b> no card de um pokémon à venda guarda o anúncio na aba <b>Favoritos</b>. Se
          alguém comprar ou o vendedor retirar, o card continua lá por alguns dias, apagado e com o
          aviso, até você limpar.</li>
          <li>A <b>Tabela de preços</b> (a prancheta) mostra as vendas recentes de todo mundo e filtra
          por tipo, por moeda (Coins ou Gemas) e por item — os Diamantes inclusive.</li>
          <li>O seu <b>Histórico de vendas</b> e o <b>de compras</b> mostram os selos <b>P·IV·Q·N</b> de
          cada pokémon, e clicar na linha abre a ficha dele.</li>
          <li>O filtro <b>Omitir Pokémon de Outland</b> (grupo <b>Espécie</b>) tira da vitrine as
          variantes #2001+: buscar "pupitar" passa a trazer só o Pupitar, sem o Ancient Pupitar.</li>
        </ul>

        <h4>Filtros de pokémon</h4>
        <p>Na aba de pokémon, além do tipo, dos selos e do <b>Filtrar por</b>, o grupo
        <b>Faixas</b> tem "mín" e "máx" para <b>nível, potência, IV total, qualidade e nota</b>.
        Dá para pedir "nota de 3,8 a 4,1", "IV acima de 166" ou "potência de P3 para cima", e
        combinar tudo. Qualidade e nota aceitam vírgula, e uma faixa digitada ao contrário vale
        como a mesma faixa.</p>

        <h4>Retenção e sorteio</h4>
        <p>O anúncio aparece na hora para todo mundo, mas só pode ser comprado depois de
        <b>${m.cooldownCompraMin ?? 2} minutos</b> de retenção. O selo <b>Retido</b> conta o tempo
        ao vivo, pelo relógio do servidor.</p>
        <ul>
          <li>Somar unidades a um anúncio que já está à venda <b>reinicia</b> a retenção. Editar o
          preço só é possível depois que ela acaba, e também a reinicia. Cancelar vale a qualquer
          momento.</li>
          <li><b>Sorteio na liberação:</b> todo pedido de compra que chega nos primeiros
          <b>${SEG_SORTEIO} segundos</b> depois de o anúncio liberar entra num sorteio com a mesma
          chance. Pedir no primeiro milissegundo não vale mais que pedir no fim da janela. Quem
          pede depois do sorteio compra na hora, como sempre.</li>
          <li><b>Um pedido por jogador em cada anúncio</b>: clicar várias vezes não dá mais
          chances. Quem perde o sorteio recebe o aviso e não paga nada.</li>
        </ul>

        <h4>Vender diamantes</h4>
        <p>A terceira aba do mercado vende <b>diamante</b> — a moeda que se compra com dinheiro de
        verdade. É o caminho para quem tem diamante e quer Coins ou Gemas, e para quem tem Coins e
        quer diamante sem passar pelo cartão.</p>
        ${nota(`<b>Só o diamante COMPRADO pode ser vendido.</b> Entram os que você pagou com PIX ou
        cartão e os que recebeu como <b>comissão de indicação</b>. Os que vieram de <b>voto no
        TopIdle</b>, do <b>pódio de guilds</b> ou de um <b>ajuste da administração</b> ficam de
        fora — eles existem para gastar na Loja, e deixá-los virar Coin transformaria um prêmio
        numa torneira de economia. A tela de anunciar mostra quantos você pode vender antes de
        pedir o preço.`, 'atencao')}
        <ul>
          <li>O preço é <b>por diamante</b>; o comprador pode levar uma <b>fatia</b> do lote.</li>
          <li>Anunciar <b>tira do seu saldo</b> na hora, como o item sai da bolsa. Cancelar
          devolve o que ainda restava no anúncio.</li>
          <li><b>Um anúncio de diamante por vez</b>, com os mesmos
          ${m.reanuncioMin ?? 30} minutos de espera entre um e o próximo. Para vender mais barato,
          edite o preço do que já está de pé.</li>
          <li>Diamante <b>comprado de outro jogador</b> não pode ser revendido: quem o recebeu não
          pagou por ele em dinheiro nenhum, e revender abriria um ciclo sem lastro.</li>
          <li>A comissão da tabela abaixo vale igual, e sai do vendedor.</li>
        </ul>

        <h4>A pensão da feira</h4>
        <p>Pokémon anunciado não fica numa prateleira: fica na <b>feira</b>, e os tratadores de lá
        cuidam dele até alguém levar. Por isso <b>só pokémon</b> paga diária —
        <b>${(m.taxaDiaria ?? 100000).toLocaleString('pt-BR')} Coins por dia</b>, de
        ${m.diasMin ?? 1} a ${m.diasMax ?? 30} dias, escolhidos na hora de publicar e pagos à vista.</p>
        <ul>
          <li><b>Item não paga nada</b> e não tem prazo: prateleira não come.</li>
          <li>Vendeu antes do fim? Os dias já pagos <b>não voltam</b> — os tratadores cuidaram dos
          dias que cuidaram.</li>
          <li>Ninguém levou? No fim do prazo o pokémon <b>volta para o seu Depot</b> sozinho —
          na hora, mesmo com o jogo aberto, e com um aviso na tela dizendo o que voltou.</li>
        </ul>

        <h4>A comissão</h4>
        ${tabela(
          [c.r.regra, c.r.taxa],
          `<tr><td>Anúncio cobrado em <b>Ouro</b></td><td class="wk-num destaque">${e.taxaMercadoGoldPct ?? 10}%</td></tr>
           <tr><td>Anúncio cobrado em <b>Gema</b></td><td class="wk-num destaque">${e.taxaMercadoOrbPct ?? 15}%</td></tr>`,
        )}
        <p>A comissão sai do <b>vendedor</b>: quem anuncia por 100 Coins recebe
        <b>${100 - (e.taxaMercadoGoldPct ?? 10)}</b>; por 100 Gemas recebe
        <b>${100 - (e.taxaMercadoOrbPct ?? 15)}</b>. O comprador paga exatamente o que está na
        vitrine.</p>

        <h4>Você recebe quando entrar</h4>
        <p>A venda cai numa <b>caixa postal</b>. Da próxima vez que você abrir o jogo (ou dentro de
        um minuto, se já estiver dentro), o valor entra e um aviso diz o que foi vendido e por
        quanto. É assim porque o vendedor quase sempre está offline na hora da venda.</p>

        <h4>A trava de preço</h4>
        ${nota(`Ao comprar, o jogo manda junto <b>o preço que estava na sua tela</b>. Se o vendedor
        tiver subido o valor entre o seu clique e a chegada da mensagem, a compra é <b>recusada</b>
        em vez de cobrar o preço novo. Se o preço tiver <b>caído</b>, você paga o mais barato. A
        moeda entra na mesma trava — um anúncio de 100 de ouro que vira 100 gemas é recusado.`,
        'aviso')}

        <h4>A ficha do anúncio</h4>
        <p>Clique na arte de um pokémon anunciado (ou em <b>Ver ficha</b>) para abrir tudo sobre
        ele: nível, XP e quanto falta para o próximo, os seis stats com o IV de cada um (SPD
        encurta cooldown), a qualidade, a nota da calculadora, o brilho e o que cada potência
        valeria naquele bicho. É a única forma honesta de julgar um preço.</p>`,
        en: `
        <p>Here the other side of the counter is <b>another player</b>. You list pokémon, items and
        <b>purchased diamonds</b>, and charge in <b>Gold</b> or in <b>Gems</b> — the USDT-backed
        currency (see <a data-cap="gemas">Gems</a>).</p>

        <h4>Listing</h4>
        <ul>
          <li>Listing <b>takes it out of your hands</b>: the item leaves your bag and the pokémon
          leaves your depot immediately. Cancelling returns it.</li>
          <li>You may hold up to <b>${e.maxAnuncios ?? 20} open listings</b> at a time.</li>
          <li><b>One listing per item</b>: while your Water Stone is on the shelf you cannot open
          a second one at another price — change the price of the one already there. Once it is
          gone (sold or cancelled), it takes <b>${m.reanuncioMin ?? 30} minutes</b> before you can
          list the same item again. That is what stops a ladder of "the same item for one Coin
          less" from taking over the whole list.</li>
          <li><b>Only items with trade value get in</b>: <b>evolution stones</b> (<b>Shiny
          Stones</b> included), <b>TM disks and pieces</b>, the <b>Bronze Boss Token</b>, the
          <b>fragments</b> (Key, Shiny Stone and Bicycle), <b>houses</b>, <b>bicycles</b>, the
          <b>Founder Boxes</b> and the <b>Beast Ball</b>. Pokémon drops (Bug Wing, Fur, Fossil…)
          don't reach the shelf — they were hundreds of thousand-coin items burying whatever you
          came looking for.</li>
          <li><b>Pokémon must clear the minimum bar</b>: <b>level ${m.pokemonMin?.level ?? 50}+</b> and
          <b>calculator score ${m.pokemonMin?.nota ?? 3.0}+</b> (birth strength — IV, quality,
          potency and shiny). <b>Shiny and P5 bypass</b> the minimum.</li>
          <li>The price is <b>per unit</b>. A lot of 100 Water Stones can be bought in slices.</li>
        </ul>

        <h4>Buying</h4>
        <p>Every pokémon bought here <b>arrives in your Collection</b>, out of NPC sales, so it
        cannot leave in a "sell the whole depot" at the <a data-cap="market">Market</a>. Return it
        to the Depot if you really want to sell it back to the NPC.</p>
        <ul>
          <li>The <b>★</b> on the card of a pokémon for sale keeps the listing in the <b>Favorites</b>
          tab. If someone buys it or the seller withdraws it, the card stays there for a few days,
          greyed out with a notice, until you clear it.</li>
          <li>The <b>Price table</b> (the clipboard) shows everyone's recent sales and filters by type,
          by currency (Coins or Gems) and by item — Diamonds included.</li>
          <li>Your <b>Sales history</b> and <b>Purchase history</b> show each pokémon's <b>P·IV·Q·N</b>
          badges, and clicking the row opens its card.</li>
          <li>The <b>Hide Outland Pokémon</b> filter (<b>Species</b> group) removes the #2001+ variants
          from the listings: searching "pupitar" now brings only Pupitar, without Ancient Pupitar.</li>
        </ul>

        <h4>Pokémon filters</h4>
        <p>On the pokémon tab, besides type, badges and <b>Filter by</b>, the <b>Ranges</b> group
        has "min" and "max" for <b>level, potency, total IV, quality and score</b>. You can ask for
        "score from 3.8 to 4.1", "IV above 166" or "potency P3 and up", and combine them all.
        Quality and score accept a decimal comma, and a range typed backwards counts as the same
        range.</p>

        <h4>Hold and draw</h4>
        <p>A listing shows up for everyone right away, but it can only be bought after a
        <b>${m.cooldownCompraMin ?? 2}-minute</b> hold. The <b>Held</b> badge counts down live, on
        the server's clock.</p>
        <ul>
          <li>Adding units to a listing that is already for sale <b>restarts</b> the hold. The price
          can only be edited once the hold is over, and editing restarts it too. Cancelling works at
          any time.</li>
          <li><b>Release draw:</b> every purchase request that arrives in the first
          <b>${SEG_SORTEIO} seconds</b> after a listing is released goes into a draw with the same
          chance. Asking in the first millisecond is worth no more than asking at the end of the
          window. Requests after the draw buy right away, as always.</li>
          <li><b>One request per player per listing</b>: clicking several times does not add
          chances. Whoever loses the draw gets a notice and pays nothing.</li>
        </ul>

        <h4>Selling diamonds</h4>
        <p>The market's third tab sells <b>diamonds</b> — the currency you buy with real money. It
        is the way out for someone holding diamonds who wants Coins or Gems, and the way in for
        someone holding Coins who wants diamonds without a card.</p>
        ${nota(`<b>Only PURCHASED diamonds can be sold.</b> That means the ones you paid for with
        PIX or a card, and the ones you received as a <b>referral commission</b>. The ones from a
        <b>TopIdle vote</b>, the <b>guild podium</b> or a <b>staff adjustment</b> stay out — those
        exist to be spent in the Shop, and letting them become Coins would turn a prize into an
        economy tap. The listing screen shows how many you can sell before it asks for a price.`,
        'atencao')}
        <ul>
          <li>The price is <b>per diamond</b>; the buyer can take a <b>slice</b> of the lot.</li>
          <li>Listing <b>takes it out of your balance</b> right away, the way an item leaves your
          bag. Cancelling returns whatever was still in the listing.</li>
          <li><b>One diamond listing at a time</b>, with the same ${m.reanuncioMin ?? 30} minutes
          of wait between one and the next. To sell cheaper, edit the price of the one already up.</li>
          <li>Diamonds <b>bought from another player</b> cannot be resold: whoever received them
          paid no money for them, and reselling would open a loop with nothing behind it.</li>
          <li>The commission in the table below applies the same, and comes out of the seller.</li>
        </ul>

        <h4>Boarding at the fair</h4>
        <p>A listed pokémon does not sit on a shelf: it stays at the <b>fair</b>, where the handlers
        look after it until someone takes it home. That is why <b>only pokémon</b> pay a daily fee —
        <b>${(m.taxaDiaria ?? 100000).toLocaleString('en-US')} Coins a day</b>, from
        ${m.diasMin ?? 1} to ${m.diasMax ?? 30} days, chosen when you publish and paid up front.</p>
        <ul>
          <li><b>Items pay nothing</b> and never expire: a shelf does not eat.</li>
          <li>Sold early? The days already paid <b>do not come back</b> — the handlers cared for the
          days they cared for.</li>
          <li>Nobody took it? When the term ends the pokémon <b>returns to your Depot</b> on its
          own — right away, even with the game open, and with a notice saying what came back.</li>
        </ul>

        <h4>The commission</h4>
        ${tabela(
          [c.r.regra, c.r.taxa],
          `<tr><td>Listing priced in <b>Gold</b></td><td class="wk-num destaque">${e.taxaMercadoGoldPct ?? 10}%</td></tr>
           <tr><td>Listing priced in <b>Gems</b></td><td class="wk-num destaque">${e.taxaMercadoOrbPct ?? 15}%</td></tr>`,
        )}
        <p>The commission comes out of the <b>seller</b>: listing for 100 Gold pays you
        <b>${100 - (e.taxaMercadoGoldPct ?? 10)}</b>; for 100 Gems pays you
        <b>${100 - (e.taxaMercadoOrbPct ?? 15)}</b>. The buyer pays exactly what is on the shelf.</p>

        <h4>You get paid when you log in</h4>
        <p>The sale lands in a <b>mailbox</b>. Next time you open the game (or within a minute, if
        you are already in), the money arrives and a notice tells you what sold and for how much.
        It works that way because the seller is almost always offline at the moment of sale.</p>

        <h4>The price lock</h4>
        ${nota(`When you buy, the game sends along <b>the price that was on your screen</b>. If the
        seller raised it between your click and the message arriving, the purchase is
        <b>refused</b> instead of charging the new price. If the price <b>dropped</b>, you pay the
        cheaper one. The currency is under the same lock — a 100-gold listing that turns into 100
        gems is refused.`, 'aviso')}

        <h4>The listing sheet</h4>
        <p>Click a listed pokémon's artwork (or <b>View sheet</b>) to open everything about it:
        level, XP and progress to the next one, the six stats with each IV (SPD shortens cooldowns),
        quality, calculator score, shine, and what each potency would be worth on that creature.
        It is the only honest way to judge a price.</p>`,
        es: `
        <p>Aquí quien está al otro lado del mostrador es <b>otro jugador</b>. Anuncias pokémon,
        objetos y <b>diamantes comprados</b>, y cobras en <b>Oro</b> o en <b>Gemas</b> — la moneda
        respaldada en USDT (ver <a data-cap="gemas">Gemas</a>).</p>

        <h4>Anunciar</h4>
        <ul>
          <li>Anunciar <b>te lo quita de la mano</b>: el objeto sale de la bolsa y el pokémon sale
          del depot al instante. Cancelar lo devuelve.</li>
          <li>Puedes tener hasta <b>${e.maxAnuncios ?? 20} anuncios abiertos</b> a la vez.</li>
          <li><b>Un anuncio por objeto</b>: mientras tu Water Stone esté en la vitrina no puedes
          abrir otro a distinto precio — cambia el precio del que ya está. Cuando salga (vendido
          o cancelado), pasan <b>${m.reanuncioMin ?? 30} minutos</b> hasta poder anunciar el mismo
          objeto otra vez. Es lo que impide que una escalera de "el mismo objeto por un Coin
          menos" se quede con toda la lista.</li>
          <li><b>Solo entra lo que tiene valor de intercambio</b>: <b>piedras de evolución</b>
          (las <b>Shiny Stones</b> incluidas), <b>discos y piezas de MT</b>, el <b>Bronze Boss
          Token</b>, los <b>fragmentos</b> (de Llave, de Shiny Stone y de Bicicleta),
          <b>casas</b>, <b>bicicletas</b>, las <b>Cajas de Fundador</b> y la <b>Beast Ball</b>. Los
          drops de pokémon (Bug Wing, Fur, Fossil…) no llegan a la vitrina — eran cientos de ítems
          de mil monedas enterrando lo que uno fue a buscar.</li>
          <li><b>El pokémon debe pasar el mínimo</b>: <b>nivel ${m.pokemonMin?.level ?? 50}+</b> y
          <b>nota ${m.pokemonMin?.nota ?? 3.0}+</b> en la calculadora (fuerza al nacer — IV,
          calidad, potencia y shiny). <b>Shiny y P5 entran</b> en cualquier nivel/nota.</li>
          <li>El precio es <b>por unidad</b>. Un lote de 100 Water Stone se puede comprar por
          partes.</li>
        </ul>

        <h4>Comprar</h4>
        <p>Todo pokémon comprado aquí <b>llega a tu Colección</b>, fuera de la venta al NPC, para
        que no se vaya en un "vender todo el depósito" del <a data-cap="market">Market</a>.
        Devuélvelo al Depósito si de verdad quieres revenderlo al NPC.</p>
        <ul>
          <li>La <b>★</b> en la tarjeta de un pokémon en venta guarda el anuncio en la pestaña
          <b>Favoritos</b>. Si alguien lo compra o el vendedor lo retira, la tarjeta sigue ahí unos
          días, apagada y con el aviso, hasta que la limpies.</li>
          <li>La <b>Tabla de precios</b> (la tablilla) muestra las ventas recientes de todos y filtra
          por tipo, por moneda (Coins o Gemas) y por objeto — los Diamantes incluidos.</li>
          <li>Tu <b>Historial de ventas</b> y el <b>de compras</b> muestran los sellos <b>P·IV·Q·N</b> de
          cada pokémon, y al pulsar la fila se abre su ficha.</li>
          <li>El filtro <b>Ocultar Pokémon de Outland</b> (grupo <b>Especie</b>) quita del escaparate las
          variantes #2001+: buscar "pupitar" trae solo el Pupitar, sin el Ancient Pupitar.</li>
        </ul>

        <h4>Filtros de pokémon</h4>
        <p>En la pestaña de pokémon, además del tipo, los sellos y el <b>Filtrar por</b>, el grupo
        <b>Rangos</b> tiene "mín" y "máx" para <b>nivel, potencia, IV total, calidad y nota</b>.
        Puedes pedir "nota de 3,8 a 4,1", "IV por encima de 166" o "potencia de P3 para arriba", y
        combinarlo todo. Calidad y nota aceptan coma, y un rango escrito al revés vale como el
        mismo rango.</p>

        <h4>Retención y sorteo</h4>
        <p>El anuncio aparece al instante para todos, pero solo se puede comprar tras
        <b>${m.cooldownCompraMin ?? 2} minutos</b> de retención. El sello <b>Retenido</b> cuenta el
        tiempo en vivo, con el reloj del servidor.</p>
        <ul>
          <li>Sumar unidades a un anuncio que ya está a la venta <b>reinicia</b> la retención.
          Editar el precio solo se puede cuando termina, y también la reinicia. Cancelar vale en
          cualquier momento.</li>
          <li><b>Sorteo en la liberación:</b> toda petición de compra que llega en los primeros
          <b>${SEG_SORTEIO} segundos</b> después de liberarse el anuncio entra en un sorteo con la
          misma probabilidad. Pedir en el primer milisegundo no vale más que pedir al final de la
          ventana. Quien pide después del sorteo compra al instante, como siempre.</li>
          <li><b>Una petición por jugador en cada anuncio</b>: pulsar varias veces no da más
          oportunidades. Quien pierde el sorteo recibe el aviso y no paga nada.</li>
        </ul>

        <h4>Vender diamantes</h4>
        <p>La tercera pestaña del mercado vende <b>diamantes</b> — la moneda que se compra con
        dinero de verdad. Es la salida para quien tiene diamantes y quiere Coins o Gemas, y la
        entrada para quien tiene Coins y quiere diamantes sin pasar por la tarjeta.</p>
        ${nota(`<b>Solo se puede vender el diamante COMPRADO.</b> Entran los que pagaste con PIX o
        tarjeta y los que recibiste como <b>comisión de recomendación</b>. Los que vinieron de
        <b>votar en TopIdle</b>, del <b>podio de guilds</b> o de un <b>ajuste de la
        administración</b> quedan fuera — existen para gastar en la Tienda, y dejar que se
        convirtieran en Coins transformaría un premio en un grifo de economía. La pantalla de
        anunciar muestra cuántos puedes vender antes de pedirte el precio.`, 'atencao')}
        <ul>
          <li>El precio es <b>por diamante</b>; el comprador puede llevarse una <b>parte</b> del
          lote.</li>
          <li>Anunciar <b>sale de tu saldo</b> al instante, como el objeto sale de la mochila.
          Cancelar devuelve lo que aún quedaba en el anuncio.</li>
          <li><b>Un anuncio de diamantes a la vez</b>, con los mismos ${m.reanuncioMin ?? 30}
          minutos de espera entre uno y el siguiente. Para vender más barato, edita el precio del
          que ya está publicado.</li>
          <li>El diamante <b>comprado a otro jugador</b> no se puede revender: quien lo recibió no
          pagó dinero por él, y revenderlo abriría un ciclo sin respaldo.</li>
          <li>La comisión de la tabla de abajo se aplica igual, y sale del vendedor.</li>
        </ul>

        <h4>La pensión de la feria</h4>
        <p>Un pokémon anunciado no se queda en un estante: se queda en la <b>feria</b>, donde los
        cuidadores lo atienden hasta que alguien se lo lleve. Por eso <b>solo el pokémon</b> paga
        diaria — <b>${(m.taxaDiaria ?? 100000).toLocaleString('es-ES')} Coins por día</b>, de
        ${m.diasMin ?? 1} a ${m.diasMax ?? 30} días, elegidos al publicar y pagados por adelantado.</p>
        <ul>
          <li><b>El ítem no paga nada</b> y no tiene plazo: un estante no come.</li>
          <li>¿Se vendió antes? Los días ya pagados <b>no vuelven</b>: los cuidadores lo atendieron
          los días que lo atendieron.</li>
          <li>¿Nadie se lo llevó? Al terminar el plazo el pokémon <b>vuelve a tu Depot</b> solo —
          al instante, aun con el juego abierto, y con un aviso en pantalla.</li>
        </ul>

        <h4>La comisión</h4>
        ${tabela(
          [c.r.regra, c.r.taxa],
          `<tr><td>Anuncio cobrado en <b>Oro</b></td><td class="wk-num destaque">${e.taxaMercadoGoldPct ?? 10}%</td></tr>
           <tr><td>Anuncio cobrado en <b>Gemas</b></td><td class="wk-num destaque">${e.taxaMercadoOrbPct ?? 15}%</td></tr>`,
        )}
        <p>La comisión sale del <b>vendedor</b>: quien anuncia por 100 Coins recibe
        <b>${100 - (e.taxaMercadoGoldPct ?? 10)}</b>; por 100 Gemas recibe
        <b>${100 - (e.taxaMercadoOrbPct ?? 15)}</b>. El comprador paga exactamente lo que está en la
        vitrina.</p>

        <h4>Cobras al entrar</h4>
        <p>La venta cae en un <b>buzón</b>. La próxima vez que abras el juego (o en un minuto, si ya
        estás dentro), el importe entra y un aviso dice qué se vendió y por cuánto. Es así porque el
        vendedor casi siempre está desconectado en el momento de la venta.</p>

        <h4>El bloqueo de precio</h4>
        ${nota(`Al comprar, el juego envía junto <b>el precio que estaba en tu pantalla</b>. Si el
        vendedor lo subió entre tu clic y la llegada del mensaje, la compra se <b>rechaza</b> en vez
        de cobrar el precio nuevo. Si el precio <b>bajó</b>, pagas el más barato. La moneda entra en
        el mismo bloqueo — un anuncio de 100 de oro que pasa a 100 gemas se rechaza.`, 'aviso')}

        <h4>La ficha del anuncio</h4>
        <p>Haz clic en el arte de un pokémon anunciado (o en <b>Ver ficha</b>) para abrir todo sobre
        él: nivel, XP y cuánto falta para el siguiente, los seis stats con su IV (SPD acorta
        cooldowns), la calidad, la nota de la calculadora, el brillo y lo que valdría cada potencia
        en ese bicho. Es la única forma honesta de juzgar un precio.</p>`,
      };
    },
  },

  // ---------------------------------------------------------------- 17. loja
  {
    id: 'loja',
    titulo: { pt: 'Loja de Diamantes', en: 'Diamond Shop', es: 'Tienda de Diamantes' },
    grupo: 'economia',
    html: (c) => {
      return {
        pt: `
        <p>A loja do JOGO. Paga-se em <b>Diamante</b>, que se compra com dinheiro de verdade
        (PIX ou cartão) e <b>acaba ao ser gasto</b>. Não confunda com a <b>Gema</b>, que é do
        <a data-cap="comunidade">Mercado da Comunidade</a> e volta em USDT.</p>

        <h4>VIP</h4>
        ${tabela(
          [c.r.efeito, c.r.regra],
          `<tr><td>+50% de XP</td><td>no treinador E no pokémon</td></tr>
           <tr><td>Auto-Catch</td><td>libera a automação <b>Lançar pokébola</b></td></tr>
           <tr><td>Outfit exclusiva</td><td>o Trainer VIP</td></tr>
           <tr><td>Emojis VIP</td><td>no chat</td></tr>`,
        )}
        <p>Renovar <b>estende</b> em vez de reiniciar: comprar 30 dias faltando 10 dá 40. O tempo
        restante aparece no seu painel, em dias, com a tag azul.</p>

        <h4>Boosts</h4>
        <p>Cinco tipos, sete durações cada. Preço em diamante:</p>
        ${tabelaDeBoosts(c)}
        <ul>
          <li><b>Não acumulam</b>: comprar o mesmo tipo de novo <b>estende</b> o que está
          correndo.</li>
          <li>Sem limite diário: compre quantos quiser, quando quiser.</li>
          <li>Tipos diferentes rodam juntos — três boosts ativos aparecem como três linhas no seu
          painel, cada uma com o próprio contador.</li>
        </ul>

        <h4>Mercado</h4>
        ${tabelaDaLoja(c, 'mercado')}
        ${nota(`O <b>Pacote de Suprimentos</b> é o melhor negócio em bolas por diamante, mas só
        pode ser comprado <b>uma vez por semana</b>. O contador aparece no próprio botão quando
        ainda está em espera.`, 'dica')}

        <h4>Outfits</h4>
        <p>Aparência para o seu treinador, ${(c.d.lojaProdutos ?? []).find((p) => p.cat === 'outfits')?.preco ?? 30}
        💎 cada. Comprar já equipa, e você troca entre as suas quando quiser.</p>`,
        en: `
        <p>The GAME's shop. You pay in <b>Diamonds</b>, bought with real money (card or PIX), and
        they are <b>gone once spent</b>. Do not confuse them with <b>Gems</b>, which belong to the
        <a data-cap="comunidade">Community Market</a> and come back as USDT.</p>

        <h4>VIP</h4>
        ${tabela(
          [c.r.efeito, c.r.regra],
          `<tr><td>+50% XP</td><td>on the trainer AND the pokémon</td></tr>
           <tr><td>Auto-Catch</td><td>unlocks the <b>Throw poké ball</b> automation</td></tr>
           <tr><td>Exclusive outfit</td><td>the VIP Trainer</td></tr>
           <tr><td>VIP emojis</td><td>in chat</td></tr>`,
        )}
        <p>Renewing <b>extends</b> rather than restarts: buying 30 days with 10 left gives you 40.
        The remaining time shows on your panel, in days, with the blue tag.</p>

        <h4>Boosts</h4>
        <p>Five types, seven durations each. Price in diamonds:</p>
        ${tabelaDeBoosts(c)}
        <ul>
          <li>They <b>do not stack</b>: buying the same type again <b>extends</b> the running
          one.</li>
          <li>No daily limit: buy as many as you want, whenever you want.</li>
          <li>Different types run together — three active boosts show as three rows on your panel,
          each with its own countdown.</li>
        </ul>

        <h4>Market</h4>
        ${tabelaDaLoja(c, 'mercado')}
        ${nota(`The <b>Supply Pack</b> is the best balls-per-diamond deal, but it can only be bought
        <b>once a week</b>. The countdown shows on the button itself while it is still on
        cooldown.`, 'dica')}

        <h4>Outfits</h4>
        <p>Looks for your trainer, ${(c.d.lojaProdutos ?? []).find((p) => p.cat === 'outfits')?.preco ?? 30}
        💎 each. Buying equips it right away, and you switch between the ones you own whenever you
        like.</p>`,
        es: `
        <p>La tienda del JUEGO. Se paga en <b>Diamantes</b>, que se compran con dinero real (PIX o
        tarjeta) y <b>se acaban al gastarse</b>. No los confundas con las <b>Gemas</b>, que son del
        <a data-cap="comunidade">Mercado de la Comunidad</a> y vuelven en USDT.</p>

        <h4>VIP</h4>
        ${tabela(
          [c.r.efeito, c.r.regra],
          `<tr><td>+50% de XP</td><td>en el entrenador Y en el pokémon</td></tr>
           <tr><td>Auto-Catch</td><td>libera la automatización <b>Lanzar poké ball</b></td></tr>
           <tr><td>Outfit exclusiva</td><td>el Trainer VIP</td></tr>
           <tr><td>Emojis VIP</td><td>en el chat</td></tr>`,
        )}
        <p>Renovar <b>extiende</b> en vez de reiniciar: comprar 30 días faltando 10 da 40. El tiempo
        restante aparece en tu panel, en días, con la etiqueta azul.</p>

        <h4>Boosts</h4>
        <p>Cinco tipos, siete duraciones cada uno. Precio en diamantes:</p>
        ${tabelaDeBoosts(c)}
        <ul>
          <li><b>No se acumulan</b>: comprar el mismo tipo otra vez <b>extiende</b> el que está
          corriendo.</li>
          <li>Sin límite diario: compra cuantos quieras, cuando quieras.</li>
          <li>Tipos distintos corren juntos — tres boosts activos aparecen como tres líneas en tu
          panel, cada una con su propio contador.</li>
        </ul>

        <h4>Mercado</h4>
        ${tabelaDaLoja(c, 'mercado')}
        ${nota(`El <b>Paquete de Suministros</b> es el mejor negocio en bolas por diamante, pero
        solo se puede comprar <b>una vez por semana</b>. El contador aparece en el propio botón
        mientras sigue en espera.`, 'dica')}

        <h4>Outfits</h4>
        <p>Apariencia para tu entrenador, ${(c.d.lojaProdutos ?? []).find((p) => p.cat === 'outfits')?.preco ?? 30}
        💎 cada una. Comprarla la equipa al momento, y cambias entre las tuyas cuando quieras.</p>`,
      };
    },
  },

  // --------------------------------------------------------- 17b. Passe de Batalha
  //
  // A tabela dos 30 dias sai da MESMA `TRILHA` que o servidor entrega (`shared/passe-batalha.mjs`):
  // mudar um prêmio lá muda esta página junto.
  {
    id: 'passe',
    titulo: { pt: 'Passe de Batalha', en: 'Battle Pass', es: 'Pase de Batalla' },
    grupo: 'economia',
    html: (c) => {
      const nomeBoost = {
        xp: 'XP Boost', pokexp: c.lang === 'en' ? 'Pokémon XP Boost' : 'XP Boost Pokémon',
        loot: 'Loot Boost', captura: 'Capture Boost', shiny: 'Shiny Secret Lure',
      };
      const L = {
        pt: { vip: 'dias de VIP', coins: 'Coins', dia: 'Dia', gratis: 'Grátis', bau: '🎁 baú', lend: '🏆 lendário' },
        en: { vip: 'days of VIP', coins: 'Coins', dia: 'Day', gratis: 'Free', bau: '🎁 chest', lend: '🏆 legendary' },
        es: { vip: 'días de VIP', coins: 'Coins', dia: 'Día', gratis: 'Gratis', bau: '🎁 cofre', lend: '🏆 legendario' },
      }[c.lang] ?? {};
      const nomeDe = (pr) => {
        if (pr.tipo === 'coins') return `${N(pr.qtd, c.lang)} ${L.coins}`;
        if (pr.tipo === 'boost') return `${nomeBoost[pr.boost] ?? pr.boost} (${pr.horas}h)`;
        if (pr.tipo === 'vip') return `${pr.dias} ${L.vip}`;
        if (pr.tipo === 'bola') {
          const b = (c.d.catalogoBolas ?? []).find((x) => x.id === pr.id);
          return `${N(pr.qtd, c.lang)}× ${b?.nome ?? '#' + pr.id}`;
        }
        const it = c.d.itens?.get?.(pr.id);
        return `${N(pr.qtd, c.lang)}× ${it?.name ?? '#' + pr.id}`;
      };
      const linhas = TRILHA_PASSE.map((d) => `<tr${d.bau ? ' class="wk-destaque"' : ''}>
          <td class="wk-num">${d.dia}${d.dia === PASSE_DIAS ? ` ${L.lend}` : d.bau ? ` ${L.bau}` : ''}</td>
          <td>${d.free.map(nomeDe).join(' + ')}</td>
          <td>${d.vip.map(nomeDe).join(' + ')}</td>
        </tr>`).join('');
      const tabelaTrilha = tabela([L.dia, L.gratis, 'VIP'], linhas);
      return {
        pt: `
        <p>O botão <b>Passe</b>, no topo ao lado do Market, é uma trilha de <b>${PASSE_DIAS} dias de
        login</b>. Entre, resgate o prêmio do dia e ande um degrau. Libera no nível
        <b>${N(PASSE_NIVEL_MIN, c.lang)}</b>.</p>
        <ul>
          <li><b>Um resgate por dia.</b> O dia vira à <b>meia-noite de Brasília</b> (03:00 UTC).</li>
          <li><b>Faltou um dia, a trilha volta ao Dia 1.</b> A tela mostra um relógio com quanto
          falta para a sequência zerar.</li>
          <li>Depois do Dia ${PASSE_DIAS} começa um ciclo novo, do Dia 1.</li>
          <li>Os dias <b>7, 14, 21 e 28</b> são baús, e o <b>Dia ${PASSE_DIAS}</b> é o lendário.</li>
        </ul>
        <h4>Passe VIP</h4>
        <p>Custa <b>${N(PASSE_VIP_PRECO, c.lang)} 💎</b> e vale <b>${PASSE_VIP_DIAS} dias corridos</b> a partir da
        compra. Enquanto ele vale, cada resgate entrega a recompensa <b>grátis E a VIP</b> do dia. Comprou
        depois de resgatar o grátis? O VIP de hoje sai na hora. O VIP <b>não é retroativo</b>: os dias
        que você resgatou antes da compra não ganham o VIP depois. Mas os ${PASSE_VIP_DIAS} dias contam
        da compra, então o que passar do Dia ${PASSE_DIAS} continua no ciclo seguinte: comprou no Dia 5,
        pega o VIP do Dia 5 ao 30 e depois do Dia 1 ao 4 do próximo ciclo. Se faltar um dia com o VIP
        ativo, a trilha volta ao Dia 1 e o relógio do VIP continua correndo. Comprar de novo
        <b>estende</b> 30 dias (até 90 acumulados).</p>
        ${tabelaTrilha}`,
        en: `
        <p>The <b>Pass</b> button, at the top next to the Market, is a <b>${PASSE_DIAS}-day login</b>
        track. Log in, claim the daily reward and move one step. Unlocks at level
        <b>${N(PASSE_NIVEL_MIN, c.lang)}</b>.</p>
        <ul>
          <li><b>One claim per day.</b> The day turns at <b>midnight Brasília time</b> (03:00 UTC).</li>
          <li><b>Miss a day and the track goes back to Day 1.</b> The screen shows a timer with how
          long until the streak resets.</li>
          <li>After Day ${PASSE_DIAS} a new cycle starts from Day 1.</li>
          <li>Days <b>7, 14, 21 and 28</b> are chests, and <b>Day ${PASSE_DIAS}</b> is the legendary one.</li>
        </ul>
        <h4>VIP Pass</h4>
        <p>Costs <b>${N(PASSE_VIP_PRECO, c.lang)} 💎</b> and lasts <b>${PASSE_VIP_DIAS} calendar days</b> from the
        purchase. While it lasts, every claim gives the day's <b>free AND VIP</b> reward. Bought it after
        claiming the free one? Today's VIP comes right away. The VIP is <b>not retroactive</b>: days you
        claimed before buying don't get the VIP afterwards. But the ${PASSE_VIP_DIAS} days count from the
        purchase, so whatever goes past Day ${PASSE_DIAS} carries over to the next cycle: buy it on Day 5
        and you get the VIP from Day 5 to 30, then Day 1 to 4 of the next cycle. Miss a day with the VIP
        active and the track goes back to Day 1 while the VIP clock keeps running. Buying again
        <b>extends</b> it by 30 days (up to 90 stacked).</p>
        ${tabelaTrilha}`,
        es: `
        <p>El botón <b>Pase</b>, arriba junto al Market, es una pista de <b>${PASSE_DIAS} días de
        conexión</b>. Entra, reclama el premio del día y avanza un escalón. Se desbloquea en el nivel
        <b>${N(PASSE_NIVEL_MIN, c.lang)}</b>.</p>
        <ul>
          <li><b>Un reclamo por día.</b> El día cambia a la <b>medianoche de Brasilia</b> (03:00 UTC).</li>
          <li><b>Si faltas un día, la pista vuelve al Día 1.</b> La pantalla muestra un reloj con
          cuánto falta para que la racha se reinicie.</li>
          <li>Después del Día ${PASSE_DIAS} empieza un ciclo nuevo, desde el Día 1.</li>
          <li>Los días <b>7, 14, 21 y 28</b> son cofres, y el <b>Día ${PASSE_DIAS}</b> es el legendario.</li>
        </ul>
        <h4>Pase VIP</h4>
        <p>Cuesta <b>${N(PASSE_VIP_PRECO, c.lang)} 💎</b> y vale <b>${PASSE_VIP_DIAS} días corridos</b> desde la
        compra. Mientras vale, cada reclamo entrega la recompensa <b>gratis Y la VIP</b> del día. ¿Lo
        compraste después de reclamar la gratis? El VIP de hoy sale en el momento. El VIP <b>no es
        retroactivo</b>: los días que reclamaste antes de la compra no reciben el VIP después. Pero los
        ${PASSE_VIP_DIAS} días cuentan desde la compra, así que lo que pase del Día ${PASSE_DIAS} sigue en
        el ciclo siguiente: si lo compraste en el Día 5, recibes el VIP del Día 5 al 30 y luego del Día 1
        al 4 del próximo ciclo. Si faltas un día con el VIP activo, la pista vuelve al Día 1 y el reloj
        del VIP sigue corriendo. Comprar de nuevo <b>extiende</b> 30 días (hasta 90 acumulados).</p>
        ${tabelaTrilha}`,
      };
    },
  },

  // --------------------------------------------------------------- 18. gemas
  {
    id: 'gemas',
    titulo: { pt: 'Gemas: depósito e saque', en: 'Gems: deposit and withdrawal', es: 'Gemas: depósito y retiro' },
    grupo: 'economia',
    html: (c) => {
      const e = c.d.economia ?? {};
      // UMA rede, a que o servidor está de fato usando. Ver a nota no `welcome`: publicar as
      // outras que o validador conhece mandaria alguém depositar na rede errada.
      const redes = e.rede ?? 'Solana (SPL)';
      return {
        pt: `
        <p>A <b>Gema</b> é a única moeda do jogo que <b>volta a ser dinheiro</b>. Você a compra
        depositando <b>USDT</b> e a saca de volta em <b>USDT</b>, para a sua carteira ou direto
        para uma corretora (Binance, OKX, Bybit — qualquer uma que aceite USDT na rede escolhida).</p>

        <h4>Os preços</h4>
        ${tabela(
          [c.r.regra, c.r.valor],
          `<tr><td>Comprar 1 Gema</td><td class="wk-num">US$ ${e.orbCompraUsdt}</td></tr>
           <tr><td>Sacar 1 Gema</td><td class="wk-num">US$ ${e.orbSaqueUsdt}</td></tr>
           <tr><td>Spread (a diferença entre as duas pontas)</td><td class="wk-num destaque">${e.spreadPct}%</td></tr>
           <tr><td>Saque mínimo</td><td class="wk-num">${N(e.saqueMinimo, c.lang)} Gemas (US$ ${((e.saqueMinimo ?? 0) * (e.orbSaqueUsdt ?? 0)).toFixed(2)})</td></tr>
           <tr><td>Taxa de rede do saque</td><td>por conta do projeto</td></tr>
        `)}
        <p>Não há taxa por transação: o <b>spread de ${e.spreadPct}%</b> é a única cobrança, e é
        dele que saem servidor, desenvolvimento e a taxa de rede dos saques.</p>

        <h4>Como DEPOSITAR</h4>
        <ol class="wk-passos">
          <li>Abra <b>Comunidade → Depósito</b>. O jogo mostra um <b>endereço só seu</b>, na rede
          ${redes}.</li>
          <li>Mande <b>USDT</b> desse endereço a partir da sua carteira ou corretora.
          <b>Confira a rede</b> — USDT existe em várias, e mandar pela errada perde o dinheiro.</li>
          <li>O jogo confirma o depósito automaticamente e credita as Gemas. Basta esperar as
          confirmações da rede.</li>
        </ol>
        ${nota(`<b>Mande só USDT, e só na rede indicada.</b> Qualquer outro token, ou o mesmo token
        noutra rede, cai num lugar de onde não há como recuperar. Isto vale para todo endereço de
        depósito de qualquer serviço — não é uma limitação nossa.`, 'aviso')}

        <h4>Como SACAR (inclusive direto para a Binance)</h4>
        <ol class="wk-passos">
          <li>Na sua corretora, vá em <b>Depositar → USDT</b> e escolha a rede
          <b>${redes}</b>. Copie o endereço de depósito que ela gerar.</li>
          <li>No jogo, abra <b>Comunidade → Withdraw</b>, cole esse endereço, escolha a mesma rede
          e diga quantas Gemas quer sacar (mínimo ${N(e.saqueMinimo, c.lang)}).</li>
          <li>Confira o endereço <b>caractere por caractere</b> na tela de confirmação. Uma
          transferência enviada <b>não tem como ser desfeita</b>.</li>
          <li>O pedido entra na fila. Você acompanha o status no extrato e, quando sair, recebe o
          <b>hash</b> da transação para conferir no explorador da rede.</li>
        </ol>
        ${nota(`Se a sua corretora pedir um <b>MEMO/TAG</b> junto do endereço, ela <b>não</b> serve
        para este saque — o campo de memo não existe aqui. Use uma carteira própria e transfira de
        lá, ou escolha uma corretora que dê endereço sem memo.`, 'aviso')}

        <h4>A transparência do caixa</h4>
        <p>A carteira do projeto é pública. No painel de depósito você vê, em tempo real, quanto
        entrou, quanto saiu, quanto está em caixa e qual é o <b>passivo</b> — o que o projeto
        deveria se todo mundo sacasse tudo agora. É esse número que precisa ficar abaixo do caixa,
        e é por isso que ele está publicado.</p>
        ${nota(`<b>Gema nunca é dada de graça.</b> Não cai de drop, não vem de quest, não sai de
        boss. Toda Gema que existe foi comprada por alguém — é isso que mantém o caixa solvente.`)}`,
        en: `
        <p>The <b>Gem</b> is the only in-game currency that <b>turns back into money</b>. You buy it
        by depositing <b>USDT</b> and withdraw it back as <b>USDT</b>, to your wallet or straight to
        an exchange (Binance, OKX, Bybit — any that accepts USDT on the chosen network).</p>

        <h4>The prices</h4>
        ${tabela(
          [c.r.regra, c.r.valor],
          `<tr><td>Buying 1 Gem</td><td class="wk-num">US$ ${e.orbCompraUsdt}</td></tr>
           <tr><td>Withdrawing 1 Gem</td><td class="wk-num">US$ ${e.orbSaqueUsdt}</td></tr>
           <tr><td>Spread (the gap between the two ends)</td><td class="wk-num destaque">${e.spreadPct}%</td></tr>
           <tr><td>Minimum withdrawal</td><td class="wk-num">${N(e.saqueMinimo, c.lang)} Gems (US$ ${((e.saqueMinimo ?? 0) * (e.orbSaqueUsdt ?? 0)).toFixed(2)})</td></tr>
           <tr><td>Withdrawal network fee</td><td>paid by the project</td></tr>
        `)}
        <p>There is no per-transaction fee: the <b>${e.spreadPct}% spread</b> is the only charge,
        and it pays for the servers, the development and the network fees on withdrawals.</p>

        <h4>How to DEPOSIT</h4>
        <ol class="wk-passos">
          <li>Open <b>Community → Deposit</b>. The game shows an <b>address that is yours alone</b>,
          on the ${redes} network.</li>
          <li>Send <b>USDT</b> to that address from your wallet or exchange. <b>Check the
          network</b> — USDT exists on several, and sending on the wrong one loses the money.</li>
          <li>The game confirms the deposit automatically and credits the Gems. Just wait for the
          network confirmations.</li>
        </ol>
        ${nota(`<b>Send only USDT, and only on the stated network.</b> Any other token, or the same
        token on another chain, lands somewhere it cannot be recovered from. This is true of every
        deposit address of every service — it is not a limitation of ours.`, 'aviso')}

        <h4>How to WITHDRAW (including straight to Binance)</h4>
        <ol class="wk-passos">
          <li>On your exchange, go to <b>Deposit → USDT</b> and pick the <b>${redes}</b>
          network. Copy the deposit address it generates.</li>
          <li>In the game, open <b>Community → Withdraw</b>, paste that address, choose the same
          network and say how many Gems to withdraw (minimum ${N(e.saqueMinimo, c.lang)}).</li>
          <li>Check the address <b>character by character</b> on the confirmation screen. A sent
          transfer <b>cannot be undone</b>.</li>
          <li>The request joins the queue. You follow its status in the statement and, once it goes
          out, you get the transaction <b>hash</b> to check on the network explorer.</li>
        </ol>
        ${nota(`If your exchange asks for a <b>MEMO/TAG</b> alongside the address, it will <b>not</b>
        work for this withdrawal — there is no memo field here. Use your own wallet and transfer
        from there, or pick an exchange that gives a memo-free address.`, 'aviso')}

        <h4>Treasury transparency</h4>
        <p>The project wallet is public. On the deposit panel you see, live, how much came in, how
        much went out, how much is on hand and what the <b>liability</b> is — what the project would
        owe if everyone withdrew everything right now. That is the number that must stay below the
        balance, and that is why it is published.</p>
        ${nota(`<b>Gems are never given away.</b> They do not drop, they do not come from quests,
        they do not come from bosses. Every Gem in existence was bought by someone — that is what
        keeps the treasury solvent.`)}`,
        es: `
        <p>La <b>Gema</b> es la única moneda del juego que <b>vuelve a ser dinero</b>. La compras
        depositando <b>USDT</b> y la retiras de nuevo en <b>USDT</b>, a tu cartera o directo a un
        exchange (Binance, OKX, Bybit — cualquiera que acepte USDT en la red elegida).</p>

        <h4>Los precios</h4>
        ${tabela(
          [c.r.regra, c.r.valor],
          `<tr><td>Comprar 1 Gema</td><td class="wk-num">US$ ${e.orbCompraUsdt}</td></tr>
           <tr><td>Retirar 1 Gema</td><td class="wk-num">US$ ${e.orbSaqueUsdt}</td></tr>
           <tr><td>Spread (la diferencia entre las dos puntas)</td><td class="wk-num destaque">${e.spreadPct}%</td></tr>
           <tr><td>Retiro mínimo</td><td class="wk-num">${N(e.saqueMinimo, c.lang)} Gemas (US$ ${((e.saqueMinimo ?? 0) * (e.orbSaqueUsdt ?? 0)).toFixed(2)})</td></tr>
           <tr><td>Comisión de red del retiro</td><td>a cargo del proyecto</td></tr>
        `)}
        <p>No hay comisión por transacción: el <b>spread del ${e.spreadPct}%</b> es el único cobro, y
        de él salen el servidor, el desarrollo y la comisión de red de los retiros.</p>

        <h4>Cómo DEPOSITAR</h4>
        <ol class="wk-passos">
          <li>Abre <b>Comunidad → Depósito</b>. El juego muestra una <b>dirección solo tuya</b>, en
          la red ${redes}.</li>
          <li>Envía <b>USDT</b> a esa dirección desde tu cartera o exchange. <b>Verifica la red</b> —
          USDT existe en varias, y enviar por la equivocada pierde el dinero.</li>
          <li>El juego confirma el depósito automáticamente y acredita las Gemas. Solo hay que
          esperar las confirmaciones de la red.</li>
        </ol>
        ${nota(`<b>Envía solo USDT, y solo en la red indicada.</b> Cualquier otro token, o el mismo
        token en otra red, cae en un lugar del que no hay forma de recuperarlo. Esto vale para toda
        dirección de depósito de cualquier servicio — no es una limitación nuestra.`, 'aviso')}

        <h4>Cómo RETIRAR (incluso directo a Binance)</h4>
        <ol class="wk-passos">
          <li>En tu exchange, ve a <b>Depositar → USDT</b> y elige la red
          <b>${redes}</b>. Copia la dirección de depósito que genere.</li>
          <li>En el juego, abre <b>Comunidad → Withdraw</b>, pega esa dirección, elige la misma red y
          di cuántas Gemas quieres retirar (mínimo ${N(e.saqueMinimo, c.lang)}).</li>
          <li>Revisa la dirección <b>carácter por carácter</b> en la pantalla de confirmación. Una
          transferencia enviada <b>no se puede deshacer</b>.</li>
          <li>El pedido entra en la cola. Sigues el estado en el extracto y, cuando salga, recibes el
          <b>hash</b> de la transacción para verificarlo en el explorador de la red.</li>
        </ol>
        ${nota(`Si tu exchange pide un <b>MEMO/TAG</b> junto con la dirección, <b>no</b> sirve para
        este retiro — aquí no existe el campo de memo. Usa una cartera propia y transfiere desde
        allí, o elige un exchange que dé dirección sin memo.`, 'aviso')}

        <h4>La transparencia de la caja</h4>
        <p>La cartera del proyecto es pública. En el panel de depósito ves, en tiempo real, cuánto
        entró, cuánto salió, cuánto hay en caja y cuál es el <b>pasivo</b> — lo que el proyecto
        debería si todos retiraran todo ahora. Ese número es el que tiene que quedar por debajo de la
        caja, y por eso está publicado.</p>
        ${nota(`<b>La Gema nunca se regala.</b> No cae de drop, no viene de misiones, no sale de
        bosses. Toda Gema que existe fue comprada por alguien — eso es lo que mantiene la caja
        solvente.`)}`,
      };
    },
  },

  // --------------------------------------------------------------- 19. taxas
  {
    id: 'taxas',
    titulo: { pt: 'Todas as taxas', en: 'Every fee', es: 'Todas las comisiones' },
    grupo: 'economia',
    html: (c) => ({
      pt: `
        <p>Tudo que o jogo desconta, num quadro só. Se não está aqui, não é cobrado.</p>
        ${tabelaDeTaxas(c)}
        ${nota(`<b>O <a data-cap="market">Market</a> do NPC não cobra nada</b>: compra e venda pelo
        valor de catálogo. As comissões moram no <a data-cap="comunidade">Mercado da
        Comunidade</a> e saem do VENDEDOR, só quando a venda acontece:
        ${c.d.economia?.taxaMercadoGoldPct ?? 10}% nos anúncios em ouro e
        ${c.d.economia?.taxaMercadoOrbPct ?? 15}% nos anúncios em Gema — a de Gema é maior porque
        Gema é dinheiro de verdade circulando entre jogadores. A pensão vale só para pokémon
        anunciado e é paga à vista, na hora de publicar.`)}`,
      en: `
        <p>Everything the game deducts, in a single table. If it is not here, it is not charged.</p>
        ${tabelaDeTaxas(c)}
        ${nota(`<b>The NPC <a data-cap="market">Market</a> charges nothing</b>: buying and selling
        are at catalogue value. The commissions live on the
        <a data-cap="comunidade">Community Market</a> and come out of the SELLER, only when the
        sale happens: ${c.d.economia?.taxaMercadoGoldPct ?? 10}% on gold listings and
        ${c.d.economia?.taxaMercadoOrbPct ?? 15}% on Gem listings — the Gem one is higher because
        Gems are real money moving between players. Boarding applies only to listed pokémon and
        is paid up front, when you publish.`)}`,
      es: `
        <p>Todo lo que el juego descuenta, en un solo cuadro. Si no está aquí, no se cobra.</p>
        ${tabelaDeTaxas(c)}
        ${nota(`<b>El <a data-cap="market">Market</a> del NPC no cobra nada</b>: compra y venta al
        valor de catálogo. Las comisiones viven en el <a data-cap="comunidade">Mercado de la
        Comunidad</a> y salen del VENDEDOR, solo cuando la venta ocurre:
        ${c.d.economia?.taxaMercadoGoldPct ?? 10}% en los anuncios en oro y
        ${c.d.economia?.taxaMercadoOrbPct ?? 15}% en los anuncios en Gema — la de Gema es mayor
        porque la Gema es dinero real circulando entre jugadores. La pensión vale solo para
        pokémon anunciados y se paga por adelantado, al publicar.`)}`,
    }),
  },
];

/** Os grupos da barra lateral, na ordem. */
export const GRUPOS = {
  basico: { pt: 'O básico', en: 'The basics', es: 'Lo básico' },
  luta: { pt: 'Luta e captura', en: 'Fighting and catching', es: 'Combate y captura' },
  mundo: { pt: 'O mundo', en: 'The world', es: 'El mundo' },
  economia: { pt: 'Economia e dinheiro', en: 'Economy and money', es: 'Economía y dinero' },
};

/**
 * Monta o HTML de um capítulo na língua pedida.
 *
 * `dados` é o que veio do `welcome` — o app.js passa `estado` inteiro por conveniência, e o
 * módulo só lê o que precisa. Uma língua que não exista cai no português, que é a mesma regra
 * do `t()`.
 */
export function corpoDoCapitulo(id, lang, dados) {
  const cap = CAPITULOS.find((x) => x.id === id);
  if (!cap) return '';
  const l = ROTULOS[lang] ? lang : 'pt';
  const c = { lang: l, r: ROTULOS[l], d: dados ?? {} };
  const partes = cap.html(c);
  // O capítulo devolve `{ pt, en, es }`. Um que já escolheu a língua (`{…}[c.lang]`) chega
  // aqui como texto — foi o que apagou o Passe e o PvP amistoso inteiros, com um "undefined".
  if (typeof partes === 'string') return partes;
  return partes?.[l] ?? partes?.pt ?? '';
}

export const tituloDoCapitulo = (id, lang) => {
  const cap = CAPITULOS.find((x) => x.id === id);
  return cap ? (cap.titulo[lang] ?? cap.titulo.pt) : '';
};

export const tituloDoGrupo = (id, lang) => GRUPOS[id]?.[lang] ?? GRUPOS[id]?.pt ?? id;

// ------------------------------------------------------- a Wiki inteira em texto
//
// Serve ao botão "Copiar toda a Wiki" — o jogador leva o manual para um assistente e estuda
// lá, perguntando o que quiser.
//
// A saída é MARKDOWN, e não o HTML cru nem texto corrido. Um modelo de linguagem lê os dois,
// mas a estrutura é metade do conteúdo aqui: `## Bosses` diz de que capítulo veio a resposta,
// e uma tabela em pipes preserva a relação entre "Bronze" e "1 / 2.000" que o texto corrido
// desmancha em duas palavras soltas na mesma linha.
//
// E o manual é montado a partir do `welcome`, então o que sai daqui não é a documentação
// genérica do jogo: são os NÚMEROS que estão valendo neste servidor, hoje.

/**
 * Espaço em branco de um nó de TEXTO, colapsado do jeito que o HTML faz.
 *
 * Só aqui, e não na junção dos pedaços: as quebras de linha que este arquivo GERA (o `\n\n`
 * de `bloco`, o `\n` entre itens de lista, as linhas de uma tabela) são estrutura de Markdown
 * e precisam sobreviver. As que vêm do HTML são indentação do código-fonte e viram espaço.
 */
const textoLimpo = (s) => String(s).replace(/[ \t\r\n]+/g, ' ');

/** Junta pedaços já normalizados. */
const juntar = (partes) => partes.join('');

/** Um bloco: garante linha em branco antes e depois, sem acumular três seguidas. */
const bloco = (txt) => `\n\n${txt.trim()}\n\n`;

/**
 * Uma `<table>` em Markdown.
 *
 * A linha de separação (`| --- |`) é obrigatória para um leitor entender que aquilo é tabela,
 * e o número de colunas dela tem de bater com o cabeçalho — por isso as células são contadas
 * na primeira linha e não em cada uma.
 */
function tabelaEmMarkdown(tabelaEl, texto) {
  const linhas = [...tabelaEl.querySelectorAll('tr')]
    .map((tr) => [...tr.children].map((celula) => texto(celula).trim().replace(/\|/g, '\\|')))
    .filter((cels) => cels.length);
  if (!linhas.length) return '';

  const colunas = linhas[0].length;
  // Sem `<thead>` a primeira linha vira cabeçalho assim mesmo: uma tabela em Markdown não
  // existe sem ele, e a primeira linha é o cabeçalho em todas as tabelas deste manual.
  const saida = [
    `| ${linhas[0].join(' | ')} |`,
    `| ${Array.from({ length: colunas }, () => '---').join(' | ')} |`,
    ...linhas.slice(1).map((cels) => `| ${cels.join(' | ')} |`),
  ];
  return bloco(saida.join('\n'));
}

/**
 * O HTML de um capítulo virado Markdown, andando no DOM em vez de raspar com expressão
 * regular — o navegador já sabe casar as tags, e uma `<b>` dentro de uma `<td>` dentro de uma
 * `<table>` é exatamente o caso em que raspar erra.
 */
function htmlEmMarkdown(html) {
  const raiz = document.createElement('div');
  raiz.innerHTML = html;

  const texto = (no) => {
    if (no.nodeType === 3) return textoLimpo(no.nodeValue); // texto puro
    if (no.nodeType !== 1) return '';
    const filhos = () => juntar([...no.childNodes].map(texto));

    switch (no.tagName) {
      case 'BR': return '\n';
      case 'B': case 'STRONG': return `**${filhos().trim()}**`;
      case 'I': case 'EM': return `*${filhos().trim()}*`;
      case 'CODE': return `\`${filhos().trim()}\``;
      case 'PRE': return bloco(`\`\`\`\n${[...no.childNodes].map(texto).join('').trim()}\n\`\`\``);
      case 'H2': case 'H3': case 'H4': case 'H5': return bloco(`### ${filhos().trim()}`);
      case 'P': return bloco(filhos().trim());
      case 'TABLE': return tabelaEmMarkdown(no, texto);
      // As linhas e células saem pela tabela; alcançadas por fora, viram texto e nada mais.
      case 'THEAD': case 'TBODY': case 'TR': case 'TD': case 'TH': return filhos();
      case 'UL': case 'OL': {
        const ordenada = no.tagName === 'OL';
        const itens = [...no.children]
          .filter((f) => f.tagName === 'LI')
          .map((f, i) => `${ordenada ? `${i + 1}.` : '-'} ${juntar([...f.childNodes].map(texto)).trim()}`);
        return itens.length ? bloco(itens.join('\n')) : '';
      }
      case 'LI': return `- ${filhos().trim()}\n`; // `<li>` solto, fora de lista
      case 'A': {
        // Link INTERNO do manual (`data-cap`): o destino não é uma URL, é outro capítulo —
        // e o texto do link já é o nome dele. Vira menção, não endereço quebrado.
        const t = filhos().trim();
        const href = no.getAttribute('href');
        return href && !no.dataset.cap ? `[${t}](${href})` : t;
      }
      default:
        // As caixas de destaque (`.wk-nota`) são o "preste atenção nisto" de cada capítulo, e
        // citação é como o Markdown diz isso.
        if (no.classList?.contains('wk-nota')) {
          return bloco(filhos().trim().split('\n').map((l) => `> ${l}`).join('\n'));
        }
        return filhos();
    }
  };

  return juntar([...raiz.childNodes].map(texto))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A Wiki inteira, na língua pedida, com os números deste servidor.
 *
 * `cabecalho` é a linha de instrução que vai na frente (quem está lendo, e para quê) — o
 * app.js a traduz, porque ela é rótulo de interface e não conteúdo do manual.
 */
export function wikiEmTexto(lang, dados, cabecalho = '') {
  const l = ROTULOS[lang] ? lang : 'pt';
  const partes = [];
  if (cabecalho) partes.push(cabecalho, '');

  let grupoAberto = null;
  for (const cap of CAPITULOS) {
    if (cap.grupo !== grupoAberto) {
      grupoAberto = cap.grupo;
      partes.push(`\n# ${tituloDoGrupo(cap.grupo, l)}`);
    }
    partes.push(`\n## ${tituloDoCapitulo(cap.id, l)}`, '', htmlEmMarkdown(corpoDoCapitulo(cap.id, l, dados)));
  }
  return partes.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
