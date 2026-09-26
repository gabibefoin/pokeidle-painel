// Temporada Global de Guilds — o ranking que NÃO reseta todo dia.
//
// `gp` (ranking Diário, `guild.mjs`/`guild-db.mjs`) zera a cada Guerra de Guilds para que o
// bônus de XP/farm não fique preso para sempre na mesma guild — ver o comentário de
// `zerarGpDiario`. Mas isso apaga o histórico: uma guild que vem ganhando toda semana não tem
// onde isso aparecer. `gp_global` é esse "onde": acumula todo GP pago em toda guerra, sem
// nunca zerar sozinho, e uma vez por mês o pódio dele leva diamante — aqui.
//
// Este arquivo só faz uma coisa: perceber que o mês virou e fechar o anterior (pagar, zerar,
// registrar). Não conhece jogador conectado além do que precisa para avisar quem estiver
// online — o resto (ledger de diamante, ranking, banco) mora em `diamantes-db.mjs` e
// `guild-db.mjs`. Mesma separação de `guild-pvp.mjs`: ele roda a guerra do dia, este fecha o
// mês; nenhum dos dois fala com `sim.mjs` de volta, os dois recebem ganchos.
import * as gdb from '../guild-db.mjs';
import * as ddb from '../diamantes-db.mjs';
import { randomUUID } from 'node:crypto';
import { publicar, CANAL_CHAT } from '../bus.mjs';
import { CANAIS_CHAT, IDIOMAS_CHAT } from '../protocol.mjs';
import { PREMIOS_GLOBAL } from '../../shared/guild-premios.mjs';

/** Diamante por MEMBRO da guild, por posição no pódio do mês. Mora no shared: a tela mostra. */
export { PREMIOS_GLOBAL };

const TEXTOS_TEMPORADA_CHAT = {
  pt: ({ podio }) =>
    `🌍 Temporada Global de Guilds fechada! ${podio}. Prêmios em diamante já caíram para os membros — ` +
    `o ranking Global zerou e recomeça agora.`,
  en: ({ podio }) =>
    `🌍 Global Guild Season closed! ${podio}. Diamond prizes already landed for the members — ` +
    `the Global ranking reset and starts fresh now.`,
  es: ({ podio }) =>
    `🌍 ¡Temporada Global de Guilds cerrada! ${podio}. Los premios en diamantes ya llegaron a los miembros — ` +
    `el ranking Global se reinició y empieza de nuevo.`,
};

let ganchos = {};
/** Injetado por `sim.mjs` — mesma ideia de `ligarGanchosG` em guild-pvp.mjs, sem importar de volta. */
export function ligarGanchosGlobal(g) {
  ganchos = { ...ganchos, ...g };
}

/** Último mês já conferido POR ESTE PROCESSO — evita reler o banco a cada tick. */
let ultimoMesChecado = null;

const mesDe = (t) => new Date(t).toISOString().slice(0, 7);

/** O mês anterior ao de `t`, em 'YYYY-MM'. `setUTCDate(1)` evita pular dois meses em dias que não existem no anterior (ex.: 31 → fevereiro). */
function mesAnteriorDe(t) {
  const d = new Date(t);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function anunciarFechamento(podioResumo) {
  if (!podioResumo.length) return;
  const podio = podioResumo
    .map((r) => `${r.pos}º ${r.nome} (+${r.diamantesCada}💎 × ${r.membros})`)
    .join(' · ');
  const ts = Date.now();
  for (const canal of CANAIS_CHAT) {
    for (const idioma of IDIOMAS_CHAT) {
      const fn = TEXTOS_TEMPORADA_CHAT[idioma] ?? TEXTOS_TEMPORADA_CHAT.pt;
      publicar(CANAL_CHAT, {
        id: randomUUID(),
        canal,
        idioma,
        de: '🌍 Temporada Global',
        texto: fn({ podio }),
        ts,
        cargo: 'anuncio',
        nivel: null,
      });
    }
  }
}

/** Fecha o mês `mes` ('YYYY-MM'): paga o pódio, zera `gp_global`, registra e avisa quem estiver online. */
async function fecharTemporada(mes) {
  const ranking = await gdb.rankingGuildGlobal(3);
  // Mesma régua do bônus diário: "com 0 GP ninguém recebe prêmio nem aparece no pódio".
  const podio = ranking.filter((g) => g.gp > 0);

  const creditos = [];
  const podioResumo = [];
  for (const g of podio) {
    const qtd = PREMIOS_GLOBAL[g.pos];
    if (!qtd) continue;
    // Os ESCALADOS, não a guild inteira: o prêmio do mês é da equipe que foi à guerra. Ver
    // `playerIdsEscalados` — e o mesmo corte vale para o bônus diário, em `carregarGuild`.
    const membrosIds = await gdb.playerIdsEscalados(g.id);
    for (const playerId of membrosIds) creditos.push({ playerId, qtd, guildNome: g.nome, pos: g.pos });
    podioResumo.push({ guildId: g.id, nome: g.nome, pos: g.pos, gp: g.gp, membros: membrosIds.length, diamantesCada: qtd });
  }

  if (creditos.length) await ddb.creditarPremioGuildGlobal({ jogadores: creditos, mes });
  await gdb.zerarGpGlobal();
  await gdb.fecharTemporada(mes, podioResumo);

  // Avisa quem está online NESTE processo — outros shards recarregam pelo próprio ciclo normal
  // (login, ou a varredura de guild já existente), o mesmo raciocínio de `avisarOnline` em
  // guild-pvp.mjs. O crédito já está no banco; isto só atualiza o cache `p.diamonds` da tela.
  const porJogador = new Map();
  for (const c of creditos) porJogador.set(c.playerId, (porJogador.get(c.playerId) ?? 0) + c.qtd);
  const jogadores = ganchos.jogadores;
  if (jogadores?.values && porJogador.size) {
    for (const p of [...jogadores.values()]) {
      const qtd = porJogador.get(p.dbId);
      if (!qtd) continue;
      p.diamonds = (Number(p.diamonds) || 0) + qtd;
      ganchos.evento?.(p, { k: 'guildGlobalPremio', qtd, mes });
    }
  }

  anunciarFechamento(podioResumo);

  console.log(
    `[guild-global] ${mes}: ${podioResumo.length ? podioResumo.map((r) =>
      `${r.nome} (${r.pos}º, ${r.diamantesCada}💎×${r.membros})`).join(', ') : 'ninguém pontuou'}`,
  );
}

/**
 * Verifica o relógio e fecha o mês anterior assim que o atual virar.
 *
 * Ao contrário da Guerra de Guilds (que precisa de uma hora fixa — é um evento ao vivo, virado
 * replay), o fechamento mensal não tem "hora do show": só paga e zera, então basta rodar assim
 * que o relógio virar o mês. A corrida entre shards é resolvida em `reivindicarTemporada`
 * (INSERT com retomada por trava), então chamar isto em todo processo é seguro.
 */
export async function verificarTemporadaGuild(t) {
  const mesAtual = mesDe(t);
  if (ultimoMesChecado === mesAtual) return;
  ultimoMesChecado = mesAtual;

  const mesFechar = mesAnteriorDe(t);
  if (!(await gdb.reivindicarTemporada(mesFechar))) return;

  try {
    await fecharTemporada(mesFechar);
  } catch (err) {
    console.error(`[guild-global] fechamento de ${mesFechar} falhou —`, err.message);
    await gdb.liberarTemporada(mesFechar).catch(() => {});
  }
}

// ------------------------------------------------------------------ testes
export function _testeResetarCache() {
  ultimoMesChecado = null;
}
