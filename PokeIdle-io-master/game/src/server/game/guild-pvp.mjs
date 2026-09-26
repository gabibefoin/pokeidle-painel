// PvP de Guild — o EVENTO: agendar, rodar a guerra do dia, pagar o GP e guardar o replay.
//
// A batalha em si mora em `guild-pvp-sim.mjs`, que não conhece banco nem jogador conectado.
// Aqui é o contrário: tudo que este arquivo faz encosta no Postgres, no chat ou em quem está
// online — e nada aqui decide um golpe.
//
// ### O que mudou em relação à arena ao vivo
//
// Antes o evento era uma arena compartilhada às 22h UTC e só entrava quem estivesse online no
// minuto certo. Agora entra o TIME de cada guild registrada — os até `MAX_TIME_GUILD` membros
// que o dono escalou (`gm.escalado`, filtrado em `membrosParaGuerra`) —, com a equipe de guerra
// salva no painel (ou a equipe de hunt de quem nunca salvou), gravada naquele instante.
// Ninguém precisa estar acordado, e o resultado é o mesmo para o cluster inteiro — antes, com
// `SHARD_COUNT > 1`, cada processo simulava um pedaço da arena sem ver o outro.
//
// O corte pelo time é o que mantém a guerra disputável depois de a guild perder o teto de
// membros: sem ele, quem convidasse mais gente ganharia por número, e não por equipe.
//
// Quem quiser ver como foi clica em "assistir ao replay": a gravação é a mesma conversa que o
// campo ao vivo tinha com o cliente, com o relógio começando em zero.
import { normalizarRefino } from '../../shared/refino-stats.mjs';
import {
  especies,
  calcularStats,
  hpDeCombate,
  multDeNascenca,
  looktypeShiny,
} from '../content.mjs';
import { empacotarVisual } from './visual.mjs';
import { gpPorColocacao, HORA_PVP_GUILD_UTC, MAX_TIME_GUILD } from './guild.mjs';
import { simularGuerra, SLUG_ARENA, VERSAO_REPLAY, LIMITE_MS_GUERRA } from './guild-pvp-sim.mjs';
import { analisarGuerra } from './guild-pvp-analise.mjs';
import { nivelNaGuerra } from '../../shared/ginasios.mjs';
import * as gdb from '../guild-db.mjs';
import { randomUUID } from 'node:crypto';
import { publicar, CANAL_CHAT } from '../bus.mjs';
import { CANAIS_CHAT, IDIOMAS_CHAT } from '../protocol.mjs';

const TEXTOS_VITORIA_CHAT = {
  pt: ({ guild, gp, guilds, mvp }) =>
    `🏆 A guild ${guild} venceu a Guerra de Guilds de hoje! (+${gp} GP · ${guilds} guilds na arena)` +
    `${mvp ? ` Destaque: ${mvp.nick} com ${mvp.abates} abates.` : ''} Assista ao replay no painel de PvP Guild.`,
  en: ({ guild, gp, guilds, mvp }) =>
    `🏆 Guild ${guild} won today's Guild War! (+${gp} GP · ${guilds} guilds in the arena)` +
    `${mvp ? ` MVP: ${mvp.nick} with ${mvp.abates} knockouts.` : ''} Watch the replay in the Guild PvP panel.`,
  es: ({ guild, gp, guilds, mvp }) =>
    `🏆 ¡La guild ${guild} ganó la Guerra de Guilds de hoy! (+${gp} GP · ${guilds} guilds en la arena)` +
    `${mvp ? ` Destacado: ${mvp.nick} con ${mvp.abates} derrotas.` : ''} Mira el replay en el panel de PvP Guild.`,
};

let ganchos = {};
/** Dia já avaliado por ESTE processo — evita reler o banco a cada tick dentro da hora do evento. */
let eventoDia = null;
/** Uma guerra rodando neste processo. Segura a reentrada enquanto a simulação respira. */
let rodando = false;
/**
 * Última batalha, em memória, para o painel não ir ao banco a cada `guild.pvp.info`.
 *
 * O cache expira sozinho: quem ROda a guerra é um processo só, e os outros shards precisam
 * enxergar o resultado sem que ninguém os avise. Um minuto de atraso num placar que muda uma
 * vez por dia é invisível, e evita uma consulta por abertura de painel.
 */
const CACHE_ULTIMA_MS = 60_000;
let ultimaBatalha = null;
let ultimaBatalhaEm = 0;

export function ligarGanchosG(g) {
  ganchos = { ...ganchos, ...g };
}

// ------------------------------------------------------------- montar a guerra

/**
 * A equipe de um jogador, do jeito que o simulador precisa: stats prontos e HP cheio.
 *
 * O nível efetivo passa pela régua da GUERRA (`nivelNaGuerra`): inteiro até 150, comprimido
 * daí para cima pelo expoente 0,20 — qualidade, potência e refino continuam valendo por
 * inteiro, só o multiplicador de nível é que desacelera.
 *
 * A régua é DA GUERRA, e não "a mesma do ginásio": as duas comprimem, mas por expoentes
 * diferentes (0,20 aqui, 0,45 lá), porque a guerra é guild contra guild com todo mundo dentro
 * e precisa de uma faixa mais curta para seguir disputável. Por isso a função aqui é
 * `nivelNaGuerra` e não `nivelNoGinasio`.
 */
function pokemonDaLinha(r) {
  const esp = especies.get(Number(r.species_id));
  if (!esp) return null;
  const ivs = typeof r.ivs === 'string' ? JSON.parse(r.ivs) : r.ivs;
  if (!ivs) return null;
  const nivel = nivelNaGuerra(Number(r.level) || 1);
  // `|| 1` e não `??`: linha ainda não alcançada pelo backfill vem com 0, que não é potência.
  const potencia = Number(r.potencia) || 1;
  // O "+N" comprado em pedras vem da linha como jsonb — `normalizarRefino` aceita `{}`, `null`
  // e texto, que é o que a coluna devolve conforme o driver. Sem isto, a guerra lutaria com os
  // stats de antes do refino.
  const refino = normalizarRefino(r.bonus_base);
  const stats = calcularStats(esp, ivs, nivel, Number(r.quality), multDeNascenca(potencia, r.shiny), refino);
  return {
    id: Number(r.pk_id),
    speciesId: esp.pokeId,
    nome: esp.name,
    looktype: esp.looktype,
    lookShiny: r.shiny ? looktypeShiny(esp.pokeId) : null,
    tipos: [esp.type1, esp.type2].filter(Boolean),
    level: nivel,
    shiny: !!r.shiny,
    stats,
    maxHp: hpDeCombate(stats.hp),
    tmElemental: r.tm_elemental ?? null,
  };
}

/**
 * As guilds registradas com os membros e as equipes, prontas para `simularGuerra`.
 *
 * O retrato é do INSTANTE do evento: quem trocar de equipe depois não muda o replay de ontem,
 * e é por isso que a gravação não guarda "a equipe atual" e sim o que foi para a arena.
 */
async function montarGuildsDaGuerra(dia) {
  const registradas = await gdb.registrosPvpDoDia(dia);
  if (!registradas.length) return [];
  const linhas = await gdb.membrosParaGuerra(registradas.map((g) => g.id));
  return guildsDasLinhas(registradas, linhas);
}

/**
 * A parte PURA da montagem: as linhas de `registrosPvpDoDia` e `membrosParaGuerra` viram as
 * guilds de `simularGuerra`. Exportada para a bancada (`tools/bancada-guerra.mjs`) poder
 * simular uma guerra de verdade a partir das linhas copiadas do banco.
 */
export function guildsDasLinhas(registradas, linhas) {
  const porGuild = new Map(registradas.map((g) => [g.id, { ...g, membros: [], porJogador: new Map() }]));
  for (const r of linhas) {
    const guild = porGuild.get(Number(r.guild_id));
    if (!guild) continue;
    const playerId = Number(r.player_id);
    let membro = guild.porJogador.get(playerId);
    if (!membro) {
      membro = {
        playerId,
        nick: r.nick,
        looktype: Number(r.looktype) || 159,
        visual: empacotarVisual(typeof r.visual === 'string' ? JSON.parse(r.visual) : r.visual),
        equipe: [],
      };
      guild.porJogador.set(playerId, membro);
      guild.membros.push(membro);
    }
    if (r.pk_id == null) continue;
    const pk = pokemonDaLinha(r);
    if (pk) membro.equipe.push(pk);
  }

  return [...porGuild.values()].map((g) => ({
    id: g.id,
    nome: g.nome,
    brasao: g.brasao,
    // A força no ranking, para o chaveamento do nascimento (`ordenarPorSemente`).
    gp: g.gp,
    gpGlobal: g.gpGlobal,
    membros: g.membros,
  }));
}

// ---------------------------------------------------------------- o anúncio

function anunciarResultado(info) {
  const ts = Date.now();
  for (const canal of CANAIS_CHAT) {
    for (const idioma of IDIOMAS_CHAT) {
      const fn = TEXTOS_VITORIA_CHAT[idioma] ?? TEXTOS_VITORIA_CHAT.pt;
      publicar(CANAL_CHAT, {
        id: randomUUID(),
        canal,
        idioma,
        de: '⚔️ Guerra de Guilds',
        texto: fn(info),
        ts,
        cargo: 'anuncio',
        nivel: null,
      });
    }
  }
}

/**
 * Avisa quem está online neste processo.
 *
 * O bônus de ranking acabou de mudar para TODA guild que pontuou, então recarregar vale para
 * qualquer membro de guild — não só para os das guilds que lutaram (o GP de uma muda a posição
 * de todas). Quem não está em guild nenhuma não tem o que recarregar.
 *
 * Um por vez, e não em rajada: cada recarga é uma consulta ao Postgres, e disparar centenas
 * juntas no instante em que a guerra acaba é o pico que derruba o pool no pior momento.
 */
async function avisarOnline(resumo) {
  const jogadores = ganchos.jogadores;
  if (!jogadores?.values) return;
  for (const p of [...jogadores.values()]) {
    if (!p.guild) continue;
    const minha = resumo.placar.find((g) => g.id === p.guild.id);
    if (minha) {
      ganchos.evento?.(p, {
        k: 'guildWarResultado',
        pos: minha.pos,
        total: resumo.totalGuilds,
        gp: minha.gp,
        guild: minha.nome,
        venceu: minha.pos === 1,
      });
    }
    await ganchos.recarregarGuild?.(p);
  }
}

// ------------------------------------------------------------------- a guerra

/**
 * Roda a guerra do dia inteirinha. Só é chamada pelo processo que reivindicou o dia.
 *
 * A simulação respira a cada punhado de ticks (`aoRespirar`) porque ela roda DENTRO do
 * processo que também simula as hunts de todo mundo: uma guerra de até 10 minutos virtuais
 * (`LIMITE_MS_GUERRA`) com centenas de bonecos e busca de caminho é trabalho de segundos de
 * CPU, e travar o event loop por esse tempo pararia o jogo do servidor inteiro.
 */
async function rodarGuerra(dia) {
  // O retrato vem ANTES de zerar: o `gp` de ontem é um dos critérios do chaveamento de quem nasce
  // onde (ver `ordenarPorSemente`), e depois do zero ele seria zero para todo mundo.
  const guilds = await montarGuildsDaGuerra(dia);

  // Todo santo dia começa do zero: sem isto, `gp` seria um acumulado para sempre — e é
  // exatamente esse acumulado que faz a mesma guild liderar (e o bônus de ranking nunca mudar
  // de dono) semana após semana. `gp_global`, que É para acumular, não é tocado aqui.
  await gdb.zerarGpDiario();

  const comLutadores = guilds.filter((g) => g.membros.some((m) => m.equipe.length));

  if (!comLutadores.length) {
    await gdb.marcarEventoEncerrado(dia, null);
    console.log(`[guild-pvp] ${dia}: nenhuma guild com equipe montada — evento sem batalha`);
    return null;
  }

  if (comLutadores.length === 1) {
    // Uma guild sozinha não briga com ninguém, mas registrou-se e compareceu: leva o GP de 1º
    // de um evento de uma guild (ou seja, 1) e nada de replay. Simular um wipe contra o vazio
    // gravaria trinta segundos de bonecos andando à toa.
    const unica = comLutadores[0];
    const gp = gpPorColocacao(1, 1);
    await gdb.adicionarGp(unica.id, gp);
    await gdb.atualizarBonusRanking();
    const resumo = {
      dia,
      motivo: 'sozinha',
      versao: VERSAO_REPLAY,
      duracaoMs: 0,
      totalGuilds: 1,
      arena: SLUG_ARENA,
      vencedor: { id: unica.id, nome: unica.nome, gp, mvp: null },
      placar: [{
        id: unica.id,
        nome: unica.nome,
        brasao: unica.brasao,
        pos: 1,
        gp,
        abates: 0,
        mortes: 0,
        membros: unica.membros.map((m) => ({ nick: m.nick, abates: 0, sobreviveu: true })),
      }],
    };
    await gdb.salvarBatalha(dia, unica.id, resumo, null);
    await gdb.marcarEventoEncerrado(dia, unica.id);
    console.log(`[guild-pvp] ${dia}: só a guild ${unica.nome} registrada — +${gp} GP, sem batalha`);
    return resumo;
  }

  const t0 = Date.now();
  const r = await simularGuerra(comLutadores, {
    aoRespirar: () => new Promise((ok) => setImmediate(ok)),
    limiteMs: LIMITE_MS_GUERRA,
  });

  const total = comLutadores.length;
  const placar = r.placar.map((g) => ({ ...g, gp: gpPorColocacao(total, g.pos) }));
  for (const g of placar) if (g.gp > 0) await gdb.adicionarGp(g.id, g.gp);
  await gdb.atualizarBonusRanking();

  const vencedor = placar.find((g) => g.pos === 1) ?? null;
  const mvp = vencedor?.membros?.[0]?.abates ? vencedor.membros[0] : null;
  const resumo = {
    dia,
    motivo: r.motivo,
    versao: VERSAO_REPLAY,
    duracaoMs: r.duracaoMs,
    totalGuilds: total,
    arena: SLUG_ARENA,
    vencedor: vencedor && { id: vencedor.id, nome: vencedor.nome, gp: vencedor.gp, mvp },
    placar,
  };

  await gdb.salvarBatalha(dia, r.vencedorId, resumo, r.replay);
  await gdb.marcarEventoEncerrado(dia, r.vencedorId);

  console.log(
    `[guild-pvp] ${dia}: ${total} guilds · ${r.replay.atores.length / 2} lutadores · ` +
      `${(r.duracaoMs / 1000).toFixed(1)}s de guerra (${r.motivo}) · ` +
      `${r.replay.quadros.length} quadros${r.replay.cheio ? ' (replay truncado)' : ''} · ` +
      `${Date.now() - t0} ms de CPU · vencedor: ${vencedor?.nome ?? '—'}`,
  );

  if (vencedor) {
    anunciarResultado({ guild: vencedor.nome, gp: vencedor.gp, guilds: total, mvp });
  }
  return resumo;
}

/**
 * Verifica o relógio UTC e dispara a guerra do dia.
 *
 * Chamada pelo tick do sim; a corrida entre shards é resolvida no banco por
 * `reivindicarEvento`, então rodar isto em todo processo é seguro e não custa nada fora da
 * hora do evento.
 */
export async function verificarEventoGuild(t) {
  if (rodando) return;
  const hora = new Date(t).getUTCHours();
  const dia = gdb.dataEventoGuild(t);
  if (hora !== HORA_PVP_GUILD_UTC) {
    // Virou o dia: solta a memória para a próxima janela ser avaliada de novo.
    if (eventoDia && eventoDia !== dia) eventoDia = null;
    return;
  }
  if (eventoDia === dia) return;

  if (await gdb.eventoEncerrado(dia)) {
    eventoDia = dia;
    return;
  }

  await gdb.registrarGuildsAutomaticas(dia);

  const registradas = await gdb.guildIdsRegistradas(dia);
  if (!registradas.length) {
    eventoDia = dia;
    // Ninguém registrou hoje, mas o dia ainda "vira": sem isto, um dia vazio deixaria o `gp` de
    // ontem grudado até a próxima guerra de verdade rodar.
    await gdb.zerarGpDiario();
    await gdb.marcarEventoEncerrado(dia, null);
    console.log(`[guild-pvp] ${dia}: nenhuma guild registrada — evento pulado`);
    return;
  }

  if (!(await gdb.reivindicarEvento(dia))) {
    // Outro processo do cluster pegou o dia. Não marca `eventoDia`: a próxima passada vê o
    // `encerrado_em` dele e sai por cima, o que também recarrega o resumo para o painel.
    return;
  }

  rodando = true;
  try {
    const resumo = await rodarGuerra(dia);
    eventoDia = dia;
    ultimaBatalhaEm = 0; // o painel deste processo já mostra o resultado no primeiro pedido
    if (resumo) await avisarOnline(resumo);
  } catch (err) {
    console.error(`[guild-pvp] ${dia}: guerra falhou —`, err.message);
    // Libera o dia: com `encerrado_em` nulo e `iniciado_em` velho, outro processo (ou este
    // mesmo, amanhã) pode tentar de novo em vez de o dia ficar preso para sempre.
    await gdb.liberarEvento(dia).catch(() => {});
  } finally {
    rodando = false;
  }
}

// ---------------------------------------------------------------- consultas

async function resumoDaUltima() {
  if (Date.now() - ultimaBatalhaEm > CACHE_ULTIMA_MS) {
    ultimaBatalha = await gdb.ultimaBatalha();
    ultimaBatalhaEm = Date.now();
  }
  return ultimaBatalha;
}

export async function infoGuildWar(p) {
  const dia = gdb.dataEventoGuild();
  await gdb.registrarGuildsAutomaticas(dia);
  const registradas = await gdb.registrosPvpDoDia(dia);
  const encerrado = await gdb.eventoEncerrado(dia);
  const minhaRegistrada = p?.guild ? registradas.some((g) => g.id === p.guild.id) : false;
  const autoRegistro = !!p?.guild?.pvpAutoRegistro;
  const ultima = await resumoDaUltima();
  return {
    horaUtc: HORA_PVP_GUILD_UTC,
    // Quantos a guild escala. A tela repete a regra por extenso, e o número tem de sair daqui
    // para não virar um 10 escrito à mão do outro lado.
    maxTime: MAX_TIME_GUILD,
    proximoEm: proximoEventoUtc(),
    eventoDia: dia,
    encerrado,
    registradas,
    minhaRegistrada,
    autoRegistro,
    gpMaximo: registradas.length,
    // O resultado da guerra mais recente, com o placar completo. É o que o painel desenha
    // embaixo do botão de assistir — sem ele o jogador só saberia quem ganhou pelo chat.
    ultima: ultima && {
      dia: ultima.dia,
      vencedorId: ultima.vencedorId,
      temReplay: ultima.temReplay,
      ...ultima.resumo,
    },
  };
}

/** A gravação de uma guerra. `null` quando o dia pedido não tem replay. */
export async function replayGuildWar(dia = null) {
  const b = await gdb.replayDaBatalha(dia);
  if (!b?.replay) return null;
  return { dia: b.dia, vencedorId: b.vencedorId, resumo: b.resumo, replay: b.replay };
}

/**
 * A ANÁLISE de uma guerra — os números de cada jogador, tirados da fita (`guild-pvp-analise.mjs`).
 *
 * ### Cache, e por que ele é por DIA
 *
 * A análise é barata de calcular (~5 ms), mas ela parte do replay, que é a coluna mais pesada do
 * banco (~600 KB de jsonb). E o pico de pedidos é previsível: o minuto depois da guerra, quando
 * a guild inteira abre o painel ao mesmo tempo. Sem cache seriam dezenas de leituras do mesmo
 * replay em segundos.
 *
 * Uma guerra gravada não muda (a não ser por `rodarGuerraAgora` com `refazer`, ferramenta de
 * dev, e pela troca de nome de guild), então o dia é a chave natural. O prazo de 10 min é só
 * para a troca de nome aparecer sem restart. O pedido em andamento também é guardado: vinte
 * cliques no mesmo segundo viram UMA leitura, e os outros dezenove esperam a mesma promessa.
 */
const CACHE_ANALISE_MS = 10 * 60_000;
const MAX_ANALISES_EM_CACHE = 4;
const cacheAnalise = new Map(); // dia → { em, promessa }

export async function analiseGuildWar(diaPedido = null) {
  // "A última" vira um DIA antes de olhar o cache — pelo resumo, que já tem cache de 1 min.
  // Chavear por 'ultima' serviria a guerra de ontem por até 10 min depois da de hoje nos
  // processos que não a rodaram.
  let dia = diaPedido;
  if (!dia) {
    const ultima = await resumoDaUltima();
    if (!ultima?.temReplay) return null;
    dia = ultima.dia;
  }
  const chave = String(dia);
  const agora = Date.now();
  const noCache = cacheAnalise.get(chave);
  if (noCache && agora - noCache.em < CACHE_ANALISE_MS) return noCache.promessa;

  const promessa = gdb.replayDaBatalha(dia).then((b) => {
    if (!b?.replay) return null;
    const analise = analisarGuerra(b.replay, { ...(b.resumo ?? {}), dia: b.dia });
    return analise && { ...analise, vencedorId: b.vencedorId };
  });
  // Um erro não fica em cache: o próximo pedido tenta de novo em vez de herdar a falha por 10 min.
  promessa.catch(() => cacheAnalise.delete(chave));
  cacheAnalise.set(chave, { em: agora, promessa });
  if (cacheAnalise.size > MAX_ANALISES_EM_CACHE) {
    const maisVelha = [...cacheAnalise.entries()].sort((a, b) => a[1].em - b[1].em)[0]?.[0];
    if (maisVelha != null) cacheAnalise.delete(maisVelha);
  }
  return promessa;
}

function proximoEventoUtc() {
  const now = new Date();
  const alvo = new Date(now);
  alvo.setUTCHours(HORA_PVP_GUILD_UTC, 0, 0, 0);
  if (now.getTime() >= alvo.getTime()) alvo.setUTCDate(alvo.getUTCDate() + 1);
  return alvo.getTime();
}

// ------------------------------------------------------- rodar na mão (dev/ops)

/**
 * Roda a guerra de um dia FORA do horário. É o que `tools/guerra-agora.mjs` chama.
 *
 * Existe por dois motivos, e nenhum deles é preguiça de esperar as 22h: em desenvolvimento,
 * ver o replay exige uma batalha gravada; em produção, um dia que tenha ficado sem resultado
 * (processo derrubado no meio, banco fora do ar no minuto exato) precisa de uma segunda
 * chance sem esperar 24 horas.
 *
 * A reivindicação é a MESMA do caminho automático — dois processos não rodam o mesmo dia.
 * `refazer` apaga o resultado anterior antes, e por isso não é o padrão: sem ele, chamar
 * duas vezes não duplica GP.
 */
export async function rodarGuerraAgora(dia = gdb.dataEventoGuild(), { refazer = false } = {}) {
  if (refazer) await gdb.apagarBatalha(dia);
  if (!(await gdb.reivindicarEvento(dia))) {
    throw new Error(`a guerra de ${dia} já foi disputada (use refazer para apagar e rodar de novo)`);
  }
  rodando = true;
  try {
    const resumo = await rodarGuerra(dia);
    eventoDia = dia;
    ultimaBatalhaEm = 0;
    if (resumo) await avisarOnline(resumo);
    return resumo;
  } finally {
    rodando = false;
  }
}

// ------------------------------------------------------------------ testes
//
// `tools/teste-guild-pvp.mjs` roda a guerra inteira sem Postgres e sem Redis: monta as guilds
// na mão e chama o simulador direto. O que precisa de atalho é só a montagem do pokémon a
// partir de uma linha de banco, que é a única regra de jogo que mora AQUI.

export const _testePokemonDaLinha = pokemonDaLinha;
