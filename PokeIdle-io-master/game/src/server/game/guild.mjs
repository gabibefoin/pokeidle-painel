// Guild — regras, brasão e bônus de ranking.
//
// A guild não tem teto de gente: o dono chama quantos quiser. O que tem teto é o TIME — os
// `MAX_TIME_GUILD` escalados que vão à Guerra de Guilds e, por isso mesmo, os únicos que levam o
// bônus diário do ranking e o diamante do fechamento mensal. Criar custa 250k de ouro. O brasão é
// um JSON pequeno (escudo + emblema + três cores) validado aqui — o cliente desenha em SVG com os
// mesmos ids.
import { BONUS_RANKING_GP } from '../../shared/guild-premios.mjs';

export const CUSTO_CRIAR_GUILD = 250_000;

/**
 * Quantos membros a guild ESCALA para a guerra.
 *
 * ### Por que o teto saiu do tamanho da guild e foi parar no time
 *
 * Com teto de membros, uma guild grande era impossível: quem queria jogar com os vinte amigos
 * tinha de abrir quatro guilds e assistir à guerra em quatro telas. Mas sem teto NENHUM a guerra
 * viraria uma conta de cabeça: a guild de cem membros ganharia de qualquer guild de dez porque
 * tem dez vezes mais bicho em campo, e o evento deixaria de medir time para medir lista de
 * convites.
 *
 * O time resolve os dois: a guild cresce sem limite (chat, ranking, convívio) e a arena continua
 * sendo dez contra dez. Quem escala é o DONO — é a decisão dele que vira a força da guild no dia.
 *
 * Guild com dez membros ou menos não escolhe nada: está toda escalada, e o editor nem aparece.
 * Ver `completarTime` em `guild-db.mjs`, que mantém isso verdadeiro sozinho.
 */
export const MAX_TIME_GUILD = 10;

export const HORA_PVP_GUILD_UTC = 22;
export const BRASAO_EDITAR_MS = 24 * 60 * 60 * 1000;

/** Bônus de XP treinador, XP pokémon e farm por posição no ranking de GP (só guilds com GP > 0). */
export { BONUS_RANKING_GP };

export function bonusPctPorPosRanking(pos) {
  if (pos === 1) return BONUS_RANKING_GP[1];
  if (pos === 2) return BONUS_RANKING_GP[2];
  if (pos === 3) return BONUS_RANKING_GP[3];
  if (pos >= 4) return BONUS_RANKING_GP.resto;
  return 0;
}

/** GP do PvP diário: N guilds registradas → 1º ganha N, 2º N−1, … último 1. */
export function gpPorColocacao(totalGuilds, colocacao) {
  const n = Number(totalGuilds) || 0;
  const c = Number(colocacao) || 0;
  if (n <= 0 || c <= 0 || c > n) return 0;
  return n - c + 1;
}

export const ESCUDOS = new Set(['heater', 'round', 'kite', 'square', 'banner']);
export const EMBLEMAS = new Set([
  'star', 'bolt', 'leaf', 'skull', 'diamond', 'heart',
  'crown', 'sword', 'flame', 'moon', 'shield', 'claw',
]);
export const BORDAS = new Set(['none', 'gold', 'silver', 'double', 'thick']);

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Normaliza e valida o brasão vindo do cliente. */
export function normalizarBrasao(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const escudo = ESCUDOS.has(b.escudo) ? b.escudo : 'heater';
  const emblema = EMBLEMAS.has(b.emblema) ? b.emblema : 'star';
  const borda = BORDAS.has(b.borda) ? b.borda : 'none';
  const cor = (c) => (typeof c === 'string' && HEX.test(c) ? c.toLowerCase() : null);
  return {
    escudo,
    emblema,
    borda,
    bg: cor(b.bg) ?? '#4a2c6e',
    pri: cor(b.pri) ?? '#ffd166',
    sec: cor(b.sec) ?? '#ffffff',
  };
}

export function nomeGuildValido(nome) {
  const s = String(nome ?? '').trim();
  if (s.length < 3 || s.length > 16) return null;
  if (!/^[a-zA-Z0-9 _-]+$/.test(s)) return null;
  return s;
}

/** Multiplicador de XP/loot vindo do ranking de GP (ex.: top 1 → 1.10). */
export const multGuildFarm = (p) => 1 + (Number(p?.guildBonusPct) || 0) / 100;
