// Consulta compartilhada das vitrines globais (Shinys e P5).
import { pool } from './db.mjs';
import { normalizarRefino, basesComRefino } from '../shared/refino-stats.mjs';
import { notaPokemon, basesDaEspecie } from '../shared/nota-pokemon.mjs';
import { REGISTRO_ORDENS } from '../shared/registro-ordem.mjs';
import { especies } from './content.mjs';

export const POR_PAGINA = 40;

const IV_SUM = `(COALESCE((pp.ivs->>'hp')::int,0)+COALESCE((pp.ivs->>'atk')::int,0)
  +COALESCE((pp.ivs->>'def')::int,0)+COALESCE((pp.ivs->>'spAtk')::int,0)
  +COALESCE((pp.ivs->>'spDef')::int,0)+COALESCE((pp.ivs->>'speed')::int,0))`;

const ivOrdem = (stat) =>
  `COALESCE((pp.ivs->>'${stat}')::int,0) DESC, pp.level DESC, pp.id DESC`;

const ORDEM_SQL = {
  recentes: 'pp.caught_at DESC NULLS LAST, pp.id DESC',
  baratos: 'ma.preco ASC NULLS LAST, pp.id DESC',
  caros: 'ma.preco DESC NULLS LAST, pp.id DESC',
  nivel: 'pp.level DESC, pp.id DESC',
  potencia: 'pp.potencia DESC, pp.level DESC, pp.id DESC',
  qualidade: 'pp.quality DESC, pp.level DESC, pp.id DESC',
  iv: `${IV_SUM} DESC, pp.level DESC, pp.id DESC`,
  ivHp: ivOrdem('hp'),
  ivAtk: ivOrdem('atk'),
  ivDef: ivOrdem('def'),
  ivSpAtk: ivOrdem('spAtk'),
  ivSpDef: ivOrdem('spDef'),
  ivSpd: ivOrdem('speed'),
  poder: 'pp.power DESC, pp.id DESC',
};

const SELECT_COLS = `pp.id, pp.species_id, pp.level, pp.xp, pp.potencia, pp.power, pp.quality, pp.ivs,
            pp.shiny, pp.bonus_base, pp.caught_at, pp.tm_elemental, pp.tm_aoe, pl.nick, pl.id AS dono_id,
            ma.id AS anuncio_id, ma.preco, ma.moeda`;

function notaDeRow(r) {
  const esp = especies.get(Number(r.species_id));
  const ivs = r.ivs ?? {};
  const ivTotal = Object.values(ivs).reduce((s, v) => s + (Number(v) || 0), 0);
  const refino = normalizarRefino(r.bonus_base);
  return notaPokemon({
    iv: ivTotal,
    ivs,
    qualidade: Number(r.quality) || 1,
    potencia: Number(r.potencia) || 1,
    shiny: !!r.shiny,
    bases: esp ? basesComRefino(esp, refino) : null,
    basesLimites: esp ? basesDaEspecie(esp) : null,
    basesAncestrais: esp?.notaAncestrais ?? null,
  }).nota;
}

function mapLinha(r) {
  return {
    id: Number(r.id),
    speciesId: Number(r.species_id),
    level: Number(r.level),
    xp: Number(r.xp) || 0,
    potencia: Number(r.potencia) || 1,
    poder: Number(r.power) || 0,
    quality: Number(r.quality) || 1,
    ivs: r.ivs ?? {},
    refino: normalizarRefino(r.bonus_base),
    shiny: !!r.shiny,
    tmElemental: r.tm_elemental ?? null,
    tmAoe: !!r.tm_aoe,
    dono: r.nick,
    donoId: Number(r.dono_id),
    caughtAt: r.caught_at?.getTime?.() ?? null,
    anuncio: r.anuncio_id
      ? { id: Number(r.anuncio_id), preco: Number(r.preco), moeda: r.moeda }
      : null,
  };
}

/**
 * @param {string[]} condicoes  ex.: `['pp.shiny']` ou [`pp.potencia = 5`]
 */
export async function listarRegistro({
  condicoes,
  speciesIds = null,
  soAVenda = false,
  ordem = 'recentes',
  pagina = 0,
} = {}) {
  const cond = [...condicoes];
  const args = [];
  if (Array.isArray(speciesIds)) cond.push(`pp.species_id = ANY($${args.push(speciesIds)}::int[])`);
  if (soAVenda) cond.push(`ma.id IS NOT NULL`);

  const de = `
      FROM player_pokemon pp
      JOIN players pl ON pl.id = pp.player_id
      LEFT JOIN market_anuncios ma
        ON ma.id = pp.anuncio_id AND ma.estado = 'aberto'
     WHERE ${cond.join(' AND ')}`;

  const { rows: cont } = await pool.query(`SELECT count(*)::int AS n ${de}`, args);
  const pag = Math.max(0, Math.min(200, Number(pagina) || 0));
  const ordemLimpa = REGISTRO_ORDENS.includes(ordem) ? ordem : 'recentes';

  let rows;
  if (ordemLimpa === 'nota') {
    const { rows: todas } = await pool.query(`SELECT ${SELECT_COLS} ${de}`, args);
    todas.sort(
      (a, b) => notaDeRow(b) - notaDeRow(a)
        || Number(b.level) - Number(a.level)
        || Number(b.id) - Number(a.id),
    );
    rows = todas.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA);
  } else {
    const sqlOrdem = ORDEM_SQL[ordemLimpa] ?? ORDEM_SQL.recentes;
    ({ rows } = await pool.query(
      `SELECT ${SELECT_COLS} ${de}
         ORDER BY ${sqlOrdem}
         LIMIT $${args.push(POR_PAGINA)} OFFSET $${args.push(pag * POR_PAGINA)}`,
      args,
    ));
  }

  return {
    total: cont[0].n,
    pagina: pag,
    porPagina: POR_PAGINA,
    ordem: ordemLimpa,
    linhas: rows.map(mapLinha),
  };
}
