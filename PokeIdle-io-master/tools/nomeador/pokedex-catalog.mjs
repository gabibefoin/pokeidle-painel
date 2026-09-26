// Catálogo Pokédex (formas + shiny) casado com o lab-index pelo slug do nome.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugsBusca, entradaJogo } from './jogo-sprites.mjs';
import { especieDe } from './dex.mjs';
import { SLUGS_OMITIDOS } from './spawns-filtro.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(AQUI, 'pokedex-lab-baseline.json');
let catalogoCache = null;
let baselineCache = null;

function entradasBaseline() {
  if (!baselineCache) {
    try {
      baselineCache = JSON.parse(readFileSync(BASELINE, 'utf-8')).entradas ?? {};
    } catch {
      baselineCache = {};
    }
  }
  return baselineCache;
}

/** Nome no lab bate com slug da espécie (meditite_2 → meditite). */
function nomeCasaComSlug(e, slug, shiny = false) {
  if (!e?.name) return false;
  if (shiny) {
    return e.name === `shiny_${slug}` || e.name === `${slug}_shiny`
      || especieDe(e.name) === slug && (e.name.startsWith('shiny_') || e.name.endsWith('_shiny'));
  }
  return (e.name === slug || especieDe(e.name) === slug) && e.kind !== 'shiny';
}

/** O locker congela qual id do lab-index vale para cada espécie — rejeita trava stale. */
function slotBaseline(outfits, slug, slot) {
  const meta = entradasBaseline()[slug]?.[slot];
  if (!meta?.id) return null;
  if (meta.fonte !== 'lab' && meta.fonte !== 'lab-alias') return null;
  const e = outfits?.[String(meta.id)];
  if (!e?.arquivo) return null;
  if (!nomeCasaComSlug(e, slug, slot === 'shiny')) return null;
  if (meta.chave) {
    const chaveLab = String(e.chave || '').split('#')[0];
    if (chaveLab && meta.chave !== chaveLab) return null;
  }
  return { entry: e, meta };
}

/** Prefere PNG do backup ({N}GEN/slug.png) quando há vários ids para o mesmo slug. */
function pontuaEntrada(e, slug, cand) {
  let pts = 0;
  if (e.name === cand) pts += 10;
  if (cand === slug && e.name === slug) pts += 5;
  const arq = String(e.arquivo || '').replace(/\\/g, '/');
  if (/^\dGEN\/shiny_[^/]+\.png$/.test(arq) || new RegExp(`^\\dGEN/${slug}\\.png$`).test(arq)) pts += 25;
  else if (/^\dGEN\//.test(arq)) pts += 20;
  else if (arq.includes('NOMEADOS/')) pts += 15;
  else if (arq.startsWith('NP/')) pts -= 5;
  if (/_\d+$/.test(e.name) && e.name !== slug) pts -= 3;
  pts += (e.id ?? 0) / 1e6;
  return pts;
}

function melhorEntrada(outfits, slug, shiny = false) {
  let best = null;
  let bestPts = -Infinity;
  let bestCand = slug;
  for (const cand of slugsBusca(slug)) {
    for (const e of Object.values(outfits)) {
      if (!e.nomeado || e.kind === 'np' || e.kind === 'vazio') continue;
      if (shiny) {
        if (e.name !== `shiny_${cand}` && e.name !== `${cand}_shiny`) continue;
      } else if (!nomeCasaComSlug(e, cand, false)) {
        continue;
      }
      const pts = pontuaEntrada(e, slug, cand);
      if (pts > bestPts) {
        bestPts = pts;
        best = e;
        bestCand = cand;
      }
    }
  }
  return best ? { entry: best, cand: bestCand } : null;
}

function ehMega({ nome, slug }) {
  return nome.startsWith('Mega ') || slug.startsWith('mega_');
}

function ehPrimal({ nome, slug }) {
  return nome.startsWith('Primal ') || slug.startsWith('primal_');
}

function ehAlolan({ nome, slug }) {
  return nome.includes('Alolan') || slug.includes('alolan');
}

function ehGalarian({ nome, slug }) {
  return nome.includes('Galarian') || slug.includes('galarian');
}

function ehHisuian({ nome, slug }) {
  return nome.includes('Hisuian') || slug.includes('hisuian');
}

function ehPaldean({ nome, slug }) {
  return nome.includes('Paldean') || slug.includes('paldean');
}

function ehTaurosRaca({ nome, slug }) {
  return (
    slug === 'tauros_aqua_breed'
    || slug === 'tauros_blaze_breed'
    || slug === 'tauros_combat_breed'
    || (nome.startsWith('Tauros (') && nome.includes('Breed'))
  );
}

/** Castform chuva/sol, Deoxys forme, etc. — mesma espécie repetida no dex. */
function ehFormaAlternativa({ slug }) {
  return /_(form|forme)(_|$)/i.test(String(slug || ''));
}

function omitirEntrada(e) {
  if (SLUGS_OMITIDOS.has(e.slug)) return true;
  if (ehMega(e) || ehPrimal(e)) return true;
  if (ehAlolan(e) || ehGalarian(e) || ehHisuian(e) || ehPaldean(e) || ehTaurosRaca(e)) return true;
  if (ehFormaAlternativa(e)) return true;
  return false;
}

export function carregarCatalogo() {
  if (catalogoCache) return catalogoCache;
  const bruto = JSON.parse(readFileSync(join(AQUI, 'pokedex-catalog.json'), 'utf-8'));
  catalogoCache = {
    ...bruto,
    geracoes: bruto.geracoes.map((g) => {
      const entradas = g.entradas.filter((e) => !omitirEntrada(e));
      return { ...g, entradas, total: entradas.length };
    }),
  };
  return catalogoCache;
}

/** Entrada mínima para o cliente desenhar o sprite. */
function resumir(e, fonteExtra = null) {
  if (!e) return null;
  return {
    id: e.id,
    name: e.name,
    arquivo: e.arquivo,
    manifest: e.manifest,
    kind: e.kind,
    fonte: fonteExtra ?? e.fonte ?? 'lab',
    looktype: e.looktype ?? null,
  };
}

/** Busca normal + shiny pelo slug — baseline primeiro, depois heurística do nome. */
export function spritesDeSlug(outfits, slug) {
  const nb = slotBaseline(outfits, slug, 'normal');
  const sb = slotBaseline(outfits, slug, 'shiny');

  const hitN = nb?.entry ? { entry: nb.entry, cand: slug } : melhorEntrada(outfits, slug, false);
  const hitS = sb?.entry ? { entry: sb.entry, cand: slug } : melhorEntrada(outfits, slug, true);

  let normal = hitN?.entry ?? null;
  let shiny = hitS?.entry ?? null;
  let normalSlug = hitN?.cand ?? null;
  let shinySlug = hitS?.cand ?? null;

  const fonteNormal = nb?.meta?.fonte === 'lab-alias' || (normalSlug && normalSlug !== slug)
    ? 'lab-alias' : null;
  const fonteShiny = sb?.meta?.fonte === 'lab-alias' || (shinySlug && shinySlug !== slug)
    ? 'lab-alias' : null;

  const out = {
    normal: resumir(normal, fonteNormal),
    shiny: resumir(shiny, fonteShiny),
  };

  if (!out.normal) out.normal = entradaJogo(slug, false);
  if (!out.shiny) out.shiny = entradaJogo(slug, true);
  if (out.normal && out.normal.fonte !== 'jogo') out.normal.fonte = out.normal.fonte ?? 'lab';
  if (out.shiny && out.shiny.fonte !== 'jogo') out.shiny.fonte = out.shiny.fonte ?? 'lab';

  return out;
}

/** Sprite normal nomeado no lab — sem fallback do espelho do jogo. */
export function spriteLabDeSlug(outfits, slug) {
  const b = slotBaseline(outfits, slug, 'normal');
  if (b) return resumir(b.entry, b.meta.fonte === 'lab-alias' ? 'lab-alias' : null);
  const hit = melhorEntrada(outfits, slug, false);
  if (hit) return resumir(hit.entry, hit.cand !== slug ? 'lab-alias' : null);
  return null;
}

/** Monta gerações com sprites casados + contagens de cobertura. */
export function montarPokedex(outfits) {
  const { geracoes } = carregarCatalogo();
  return {
    fonte: 'pokemondb.net/pokedex/shiny',
    geracoes: geracoes.map((g) => {
      let comNormal = 0;
      let comShiny = 0;
      let completos = 0;
      const entradas = g.entradas.map((e) => {
        const par = spritesDeSlug(outfits, e.slug);
        if (par.normal) comNormal++;
        if (par.shiny) comShiny++;
        if (par.normal && par.shiny) completos++;
        return { ...e, ...par };
      });
      return {
        id: g.id,
        rotulo: g.rotulo,
        regiao: g.regiao,
        min: g.min,
        max: g.max,
        total: entradas.length,
        stats: { comNormal, comShiny, completos },
        entradas,
      };
    }),
  };
}
