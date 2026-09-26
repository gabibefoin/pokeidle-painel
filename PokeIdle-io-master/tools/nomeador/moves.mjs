/**
 * Catálogo de efeitos visuais de golpes — o que o jogo espelha em `public/data/effects/moves/`.
 *
 * A folha de cada efeito é uma tira VERTICAL: quadro i em (0, i × frameH). O combate usa
 * principalmente os 18 tipos elementais; o resto são animações nomeadas (golpes especiais, FX_*).
 *
 * A biblioteca Trampar (`Desktop/Trampar/Efeitos`) alimenta os efeitos exclusivos dos TM Elemental.
 */
import { readFile, writeFile, copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tramparEfeitos } from '../caminhos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const JOGO = resolve(AQUI, '../../public/data');
const DADOS = resolve(AQUI, '../../game/src/server/dados');
const TM_EFEITOS_JSON = join(DADOS, 'tm-elemental-efeitos.json');
const TM_PUBLIC_DIR = join(JOGO, 'effects/tm-elemental');
const TM_PUBLIC_INDEX = join(TM_PUBLIC_DIR, 'index.json');
const MOVES_DIR = join(JOGO, 'effects/moves');

export const TM_SAVE_API = 2;

export const TIPOS_ELEMENTAIS = [
  'NORMAL', 'FIRE', 'WATER', 'ELECTRIC', 'GRASS', 'ICE', 'FIGHTING', 'POISON',
  'GROUND', 'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY',
];

const TIPOS_SET = new Set(TIPOS_ELEMENTAIS);
const FRAME_H_CANDIDATOS = [32, 48, 64, 96, 128, 192];

export function categoriaEfeito(id) {
  if (TIPOS_SET.has(id)) return 'tipo';
  if (id.startsWith('FX_')) return 'fx';
  if (id === 'SWITCH') return 'outro';
  return 'golpe';
}

function idDeArquivoTrampar(nome) {
  const m = String(nome).match(/^effect_(\d+)_\.png$/i);
  return m ? m[1] : nome.replace(/\.png$/i, '');
}

/** Lê largura/altura do IHDR de um PNG (sem dependências). */
function medidasPng(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Layout da folha: tira vertical (cols=1) ou grade — quadro i em (col×frameW, row×frameH). */
export function inferirMetaTrampar(w, h) {
  if (!(w > 0 && h > 0)) return null;

  let best = null;
  const larguras = new Set(FRAME_H_CANDIDATOS);
  larguras.add(w);

  for (const fw of larguras) {
    if (w % fw !== 0) continue;
    for (const fh of FRAME_H_CANDIDATOS) {
      if (h % fh !== 0) continue;
      const cols = w / fw;
      const rows = h / fh;
      const frames = cols * rows;
      if (frames < 2 || frames > 120) continue;

      const squareness = 1 - Math.abs(fw - fh) / Math.max(fw, fh);
      let score = (cols === 1 ? 20 : 0) + squareness * 10 + (fw >= 64 && fh >= 64 ? 5 : 0);
      if (cols > 1 && squareness > 0.85) score += 18;
      if (cols > 1) score -= 3 * cols;
      if (cols === 1 && (fw / fh > 2.5 || fh / fw > 2.5)) score -= 35;

      if (!best || score > best.score) {
        best = { frameW: fw, frameH: fh, frames, cols, rows, score };
      }
    }
  }

  if (!best) return null;
  return {
    frameW: best.frameW,
    frameH: best.frameH,
    frames: best.frames,
    cols: best.cols,
    rows: best.rows,
    frameMs: 60,
    scale: 1,
    offset: [0, 0],
  };
}

function ataquesPorTipo(porAtaque) {
  const map = Object.fromEntries(TIPOS_ELEMENTAIS.map((t) => [t, []]));
  for (const a of Object.values(porAtaque ?? {})) {
    const t = String(a.tipo ?? '').toUpperCase();
    if (!map[t]) continue;
    map[t].push(a.nome);
  }
  for (const t of TIPOS_ELEMENTAIS) map[t].sort((a, b) => a.localeCompare(b, 'pt'));
  return map;
}

let cacheTrampar = null;
let cacheTramparMtime = 0;

export async function escanearBibliotecaTrampar() {
  const pasta = tramparEfeitos();
  let st;
  try {
    st = await stat(pasta);
  } catch {
    return { pasta, ausente: true, total: 0, efeitos: [] };
  }
  if (cacheTrampar && cacheTramparMtime === st.mtimeMs) return cacheTrampar;

  const nomes = (await readdir(pasta)).filter((f) => f.toLowerCase().endsWith('.png'));
  const efeitos = [];
  for (const file of nomes) {
    const id = idDeArquivoTrampar(file);
    let meta = null;
    try {
      const buf = await readFile(join(pasta, file));
      const med = medidasPng(buf);
      if (med) meta = inferirMetaTrampar(med.w, med.h);
    } catch { /* skip */ }
    if (!meta) continue;
    efeitos.push({
      id,
      file,
      ...meta,
      duracaoMs: meta.frames * meta.frameMs,
      categoria: 'trampar',
    });
  }
  efeitos.sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id));

  cacheTrampar = {
    pasta,
    ausente: false,
    gerado: new Date().toISOString(),
    total: efeitos.length,
    efeitos,
  };
  cacheTramparMtime = st.mtimeMs;
  return cacheTrampar;
}

async function carregarEfeitosJogoRaw() {
  return JSON.parse(await readFile(join(MOVES_DIR, 'index.json'), 'utf8'));
}

function metaEfeitoJogo(id, meta) {
  return {
    id,
    source: 'jogo',
    categoria: categoriaEfeito(id),
    file: meta.file,
    frameW: meta.frameW,
    frameH: meta.frameH,
    frames: meta.frames,
    frameMs: meta.frameMs ?? 60,
    scale: meta.scale ?? 1,
    offset: meta.offset ?? [0, 0],
    cols: meta.cols ?? 1,
    rows: meta.rows ?? meta.frames,
    duracaoMs: (meta.frames ?? 0) * (meta.frameMs ?? 60),
  };
}

/** Golpes nomeados + FX genéricos do jogo (espelhados em `effects/moves/`). */
export async function listarEfeitosJogoTm() {
  const raw = await carregarEfeitosJogoRaw();
  return Object.entries(raw)
    .map(([id, meta]) => metaEfeitoJogo(id, meta))
    .filter((e) => e.categoria === 'golpe' || e.categoria === 'fx')
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

function normalizarEntradaTm(item) {
  if (item == null || item === '') return null;
  if (typeof item === 'string') {
    const s = item.trim();
    if (!s || s === '[object Object]') return null;
    const i = s.indexOf(':');
    if (i > 0) {
      const source = s.slice(0, i);
      const id = s.slice(i + 1).trim();
      if ((source === 'jogo' || source === 'trampar') && id) {
        return { source, id, frameMs: null };
      }
    }
    return { source: 'trampar', id: s, frameMs: null };
  }
  if (typeof item !== 'object') return null;

  let source = item.source === 'jogo' ? 'jogo' : 'trampar';
  let id = item.id ?? item.chave ?? item.value ?? '';
  if (id != null && typeof id === 'object') id = id.id ?? id.chave ?? '';
  id = String(id ?? '').trim();
  if (id.includes(':') && !item.source) {
    const parsed = normalizarEntradaTm(id);
    if (parsed?.id) {
      source = parsed.source;
      id = parsed.id;
    }
  }
  if (!id || id === '[object Object]') return null;
  return { source, id, frameMs: item.frameMs };
}

async function resolverCatalogosTm() {
  const biblioteca = await escanearBibliotecaTrampar();
  const jogo = await listarEfeitosJogoTm();
  const porTrampar = Object.fromEntries(biblioteca.efeitos.map((e) => [e.id, { ...e, source: 'trampar' }]));
  const porJogo = Object.fromEntries(jogo.map((e) => [e.id, e]));
  return { biblioteca, jogo, porTrampar, porJogo };
}

function resolverFxTm(entrada, porTrampar, porJogo) {
  const norm = normalizarEntradaTm(entrada);
  if (!norm?.id) return null;
  const cat = norm.source === 'jogo' ? porJogo : porTrampar;
  const fx = cat[norm.id];
  if (!fx) return { erro: `Efeito ${norm.source}:${norm.id} não encontrado` };
  const frameMs = Math.max(10, Math.min(500, Math.round(Number(norm.frameMs) || fx.frameMs || 60)));
  return { fx: { ...fx, frameMs }, salvar: { source: norm.source, id: fx.id, file: fx.file, frameMs } };
}

export async function carregarTmElementalEfeitos() {
  let raw = {};
  try {
    raw = JSON.parse(await readFile(TM_EFEITOS_JSON, 'utf8'));
  } catch { /* vazio */ }

  const { biblioteca, jogo, porTrampar, porJogo } = await resolverCatalogosTm();

  const atribuicoes = {};
  const salvos = {};
  for (const tipo of TIPOS_ELEMENTAIS) {
    const salvo = raw[tipo];
    if (!salvo?.id) continue;
    const r = resolverFxTm(salvo, porTrampar, porJogo);
    if (r?.erro || !r?.fx) continue;
    atribuicoes[tipo] = r.fx;
    salvos[tipo] = r.salvar;
  }

  return {
    gerado: new Date().toISOString(),
    pastaTrampar: biblioteca.pasta,
    bibliotecaAusente: biblioteca.ausente,
    totalBiblioteca: biblioteca.total,
    totalJogoTm: jogo.length,
    tiposElementais: TIPOS_ELEMENTAIS,
    efeitosJogoTm: jogo,
    atribuicoes,
    salvos,
  };
}

async function publicarTmElementalNoJogo(atribuicoes) {
  const pastaTrampar = tramparEfeitos();
  await mkdir(TM_PUBLIC_DIR, { recursive: true });

  const index = {};
  for (const tipo of TIPOS_ELEMENTAIS) {
    const fx = atribuicoes[tipo];
    if (!fx?.id) continue;
    const origem = fx.source === 'jogo'
      ? join(MOVES_DIR, fx.file)
      : join(pastaTrampar, fx.file);
    const destino = `${tipo}.png`;
    await copyFile(origem, join(TM_PUBLIC_DIR, destino));
    index[tipo] = {
      file: destino,
      frameW: fx.frameW,
      frameH: fx.frameH,
      frames: fx.frames,
      frameMs: fx.frameMs ?? 60,
      scale: fx.scale ?? 1,
      offset: fx.offset ?? [0, 0],
      cols: fx.cols ?? 1,
      rows: fx.rows ?? fx.frames,
      source: fx.source ?? 'trampar',
      efeitoId: fx.id,
      efeitoFile: fx.file,
    };
  }

  await writeFile(TM_PUBLIC_INDEX, `${JSON.stringify(index, null, 1)}\n`, 'utf8');
  return { publicados: Object.keys(index).length };
}

/** Persiste escolhas do painel TM Elemental e copia PNGs para `public/data/effects/tm-elemental/`. */
export async function salvarTmElementalEfeitos(body) {
  const { biblioteca, porTrampar, porJogo } = await resolverCatalogosTm();
  const entrada = body?.atribuicoes ?? body ?? {};
  const atribuicoes = {};
  const salvar = {};

  for (const tipo of TIPOS_ELEMENTAIS) {
    const item = entrada[tipo];
    if (item == null || item === '') continue;
    const r = resolverFxTm(item, porTrampar, porJogo);
    if (r?.erro) return { erro: r.erro };
    if (!r?.fx) continue;
    atribuicoes[tipo] = r.fx;
    salvar[tipo] = r.salvar;
  }

  const usaTrampar = Object.values(salvar).some((s) => s.source !== 'jogo');
  if (usaTrampar && biblioteca.ausente) {
    return { erro: `Pasta Trampar não encontrada: ${biblioteca.pasta}` };
  }

  await writeFile(TM_EFEITOS_JSON, `${JSON.stringify(salvar, null, 1)}\n`, 'utf8');
  const pub = await publicarTmElementalNoJogo(atribuicoes);

  return {
    ok: true,
    salvos: Object.keys(salvar).length,
    publicados: pub.publicados,
    msg: `${pub.publicados} TM Elemental publicados em public/data/effects/tm-elemental/`,
  };
}

export async function montarPainelMoves() {
  const efeitosRaw = JSON.parse(
    await readFile(join(JOGO, 'effects/moves/index.json'), 'utf8'),
  );

  let porAtaque = {};
  try {
    const mi = JSON.parse(await readFile(join(JOGO, 'index/moves-index.json'), 'utf8'));
    porAtaque = mi.porAtaque ?? {};
  } catch { /* índice opcional — rode build-indexes */ }

  const porTipo = ataquesPorTipo(porAtaque);
  const totalAtaques = Object.keys(porAtaque).length;

  const efeitos = Object.entries(efeitosRaw)
    .map(([id, meta]) => ({
      id,
      categoria: categoriaEfeito(id),
      file: meta.file,
      frameW: meta.frameW,
      frameH: meta.frameH,
      frames: meta.frames,
      frameMs: meta.frameMs ?? 60,
      scale: meta.scale ?? 1,
      offset: meta.offset ?? [0, 0],
      duracaoMs: (meta.frames ?? 0) * (meta.frameMs ?? 60),
      ataques: TIPOS_SET.has(id) ? (porTipo[id] ?? []) : [],
    }))
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));

  const resumo = {
    total: efeitos.length,
    tipos: efeitos.filter((e) => e.categoria === 'tipo').length,
    golpes: efeitos.filter((e) => e.categoria === 'golpe').length,
    fx: efeitos.filter((e) => e.categoria === 'fx').length,
    outros: efeitos.filter((e) => e.categoria === 'outro').length,
    ataquesDistintos: totalAtaques,
    quadros: efeitos.reduce((s, e) => s + (e.frames ?? 0), 0),
  };

  const trampar = await escanearBibliotecaTrampar();
  const tm = await carregarTmElementalEfeitos();

  return {
    gerado: new Date().toISOString(),
    resumo,
    efeitos,
    tiposElementais: TIPOS_ELEMENTAIS,
    trampar,
    tmElemental: tm,
    tmSaveApi: TM_SAVE_API,
  };
}
