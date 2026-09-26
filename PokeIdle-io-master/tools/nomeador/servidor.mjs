// Nomeador de sprites — servidor local do Sprite Lab de renomeação.
//
//   node tools/nomeador/servidor.mjs        →  http://localhost:5174
//
// Serve três coisas: a página (public/), os atlas .webp já convertidos (/lab/…)
// e os PNGs de origem (/png/…, só para os poucos que não viraram atlas). A única
// rota que escreve é POST /api/nome, que renomeia o PNG de origem no disco e
// atualiza o índice. Todo rename vai para LAB/renomeacoes.jsonl, então dá para
// desfazer qualquer coisa mesmo fora da interface.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { stat, readFile, writeFile, rename, appendFile, mkdir, readdir } from 'node:fs/promises';
import { join, extname, normalize, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAIXAS, carregarDex, statsPorGeracao, PASTAS_GEN } from './dex.mjs';
import { montarPokedex } from './pokedex-catalog.mjs';
import { LENDARIO_DEX, resumoLendarios, fontePorTipo } from './spawns-filtro.mjs';
import { aplicarEscalaHuntLevel, montarCadeias, huntLevelDoDex } from '../../game/src/shared/escala-hunt-level.mjs';
import { bonecosDaRaridade } from '../../game/src/shared/casas.mjs';
import { publicarJogoNoDisco } from './publicar-jogo.mjs';
import { backupPokedex } from './backup-pokedex.mjs';
import { montarPokedexOficial, caminhoArquivoBackup } from './pokedex-oficial.mjs';
import {
  montarPainel as montarPainelEconomia,
  detalheItem as detalheItemEconomia,
  detalheEspecie as detalheEspecieEconomia,
  autonomia as autonomiaEconomia,
  nivelTetoPocao,
} from './economia.mjs';
import {
  montarPainelMoves,
  escanearBibliotecaTrampar,
  carregarTmElementalEfeitos,
  salvarTmElementalEfeitos,
} from './moves.mjs';
import { tramparEfeitos } from '../caminhos.mjs';
import {
  analisarArea,
  analisarAreaComGrade,
  carregarBloqueantes,
  normalizarPassagensPorAndar,
  normalizarEscadas,
} from './casas-walkgrid.mjs';
import { spritesRaiz, pokedexBackup } from '../caminhos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(spritesRaiz());
const LAB = join(RAIZ, 'LAB');
const INDICE = join(LAB, 'lab-index.json');
const SILHUETAS = join(LAB, 'silhuetas.json');
const LOG = join(LAB, 'renomeacoes.jsonl');
const PUBLICO = join(AQUI, 'public');
const FAVICON_DIR = resolve(AQUI, '../../game/src/client/img');
const PUBLIC_GAME = resolve(AQUI, '../../public');
const JOGO = resolve(AQUI, '../../public/data');
const DADOS = resolve(AQUI, '../../game/src/server/dados');
const SPAWNS_EDITOR = join(DADOS, 'spawns-editor.json');
const MAPAS_EDITOR = join(DADOS, 'mapas-editor.json');
const MAPAS_POOLS = join(DADOS, 'mapas-pools.json');
const CASAS_EDITOR = join(DADOS, 'casas-editor.json');
const GINASIOS_EDITOR = join(DADOS, 'ginasios-editor.json');
const CREATURES_NOVOS = join(DADOS, 'creatures-novos.json');
const SPRITES_LAB = join(DADOS, 'creatures-sprites-lab.json');
const CREATURES = [
  join(JOGO, 'creatures.json'),
  resolve(AQUI, '../../game/public/data/creatures.json'),
];
const CREATURES_PATHS = [...CREATURES, CREATURES_NOVOS];
/** Porta fixa do Sprite Lab — não usa `process.env.PORT` (8080 do jogo). */
const PORT = Number(process.env.NOMEADOR_PORT) || 5174;
const POKEDEX_BACKUP = pokedexBackup();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// ------------------------------------------------------------------- índice

let indice = null; // { format, raiz, outfits: { id: entrada } }
let indiceMtime = 0;
let cacheEspecies = null;
let gravando = Promise.resolve();

const idDoManifest = (manifest) => {
  const m = String(manifest || '').match(/outfits-male-(\d+)-/);
  return m ? Number(m[1]) : null;
};

async function manifestDeId(oid) {
  const dir = join(LAB, 'categories');
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  let best = null;
  let bestM = 0;
  for (const f of files) {
    if (!f.startsWith(`outfits-male-${oid}-`) || !f.endsWith('.json')) continue;
    const path = join(dir, f);
    try {
      const m = (await stat(path)).mtimeMs;
      if (m >= bestM) { bestM = m; best = f; }
    } catch { /* skip */ }
  }
  if (!best) return null;
  const rel = `/assets-packs/categories/${best}`;
  const path = join(dir, best);
  try {
    const doc = JSON.parse(await readFile(path, 'utf-8'));
    const cat = doc.categories?.[`outfits/male/${oid}`];
    const g = cat?.geometry ?? {};
    return {
      manifest: rel,
      category: `outfits/male/${oid}`,
      directions: g.directions ?? 4,
      frames: g.frames ?? 2,
      width: g.width ?? 1,
      height: g.height ?? 1,
    };
  } catch {
    return { manifest: rel, category: `outfits/male/${oid}` };
  }
}

async function carregar() {
  indice = JSON.parse(await readFile(INDICE, 'utf-8'));
  cacheEspecies = null;
  let consertados = 0;
  let chaves = 0;
  let manifests = 0;
  for (const [k, e] of Object.entries(indice.outfits)) {
    if (Number(e.id) !== Number(k)) {
      e.id = Number(k);
      consertados++;
    }
    const pasta = e.pasta || '';
    if (!e.arquivo) continue;
    const png = join(RAIZ, pasta, posix.basename(e.arquivo));
    try {
      const buf = await readFile(png);
      const h = createHash('md5').update(buf).digest('hex').slice(0, 16);
      const esperado = String(e.chave || '').split('#')[0];
      if (esperado && h !== esperado) {
        const sufixo = String(e.chave || '').includes('#')
          ? String(e.chave).slice(String(e.chave).indexOf('#'))
          : '';
        e.chave = h + sufixo;
        chaves++;
      }
    } catch {
      /* PNG ausente — validarEntrada pega no rename */
    }

    const oid = Number(k);
    const mid = idDoManifest(e.manifest);
    const manPath = e.manifest
      ? join(LAB, String(e.manifest).replace('/assets-packs/', '').replace(/\//g, join.sep))
      : null;
    const manOk = mid === oid && manPath;
    if (!manOk || (manPath && !(await stat(manPath).then(() => true, () => false)))) {
      const fix = await manifestDeId(oid);
      if (fix) {
        Object.assign(e, fix);
        manifests++;
      } else if (e.manifest) {
        delete e.manifest;
        e.category = `outfits/male/${oid}`;
        manifests++;
      }
    }
  }
  if (consertados || chaves || manifests) {
    if (consertados) console.warn(`  índice: ${consertados} ids desalinhados corrigidos automaticamente`);
    if (chaves) console.warn(`  índice: ${chaves} chaves MD5 sincronizadas com o PNG no disco`);
    if (manifests) console.warn(`  índice: ${manifests} manifests realinhados ao id da carta`);
    await salvar();
  }
  try {
    indiceMtime = (await stat(INDICE)).mtimeMs;
  } catch {
    indiceMtime = Date.now();
  }
}

/** Recarrega lab-index.json se o construir.py (ou outro processo) reescreveu o disco. */
async function garantirIndice() {
  try {
    const st = await stat(INDICE);
    if (st.mtimeMs > indiceMtime) await carregar();
  } catch {
    /* indice ausente — carregar() na subida já falhou */
  }
}

// Grava serializado e por troca de arquivo: um Ctrl+C no meio nunca deixa o
// índice pela metade, e dois renames seguidos não corrompem um ao outro.
function salvar() {
  gravando = gravando.then(async () => {
    const tmp = `${INDICE}.tmp`;
    await writeFile(tmp, JSON.stringify(indice), 'utf-8');
    await rename(tmp, INDICE);
    indiceMtime = (await stat(INDICE)).mtimeMs;
  });
  return gravando;
}

// ------------------------------------------------------------------- nomes

// `Farfetch'd` → `farfetchd`, `Mr. Mime` → `mr_mime`. Mesma convenção dos
// arquivos que já estavam nomeados na pasta. O apóstrofo some em vez de virar
// `_`, senão o Farfetch'd nunca casaria com o `farfetchd` da lista de espécies.
function limpar(nome) {
  return nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019.]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

// Lista fechada: o destino vem do cliente e vira caminho de disco.
const PASTAS = ['', 'NOMEADOS', 'NP', 'SHINYS_NOVOS', 'VAZIOS', ...PASTAS_GEN];

// A pasta manda no kind; dentro da raiz, quem manda é o nome.
const classificar = (e, pasta) =>
  pasta === 'NP' ? 'np'
  : pasta === 'VAZIOS' ? 'vazio'
  : !e.nomeado ? 'pendente'
  : e.name.startsWith('shiny_') || e.name.endsWith('_shiny') ? 'shiny'
  : 'pokemon';

async function existe(p) {
  try { await stat(p); return true; } catch { return false; }
}

// Nome livre na pasta: `pikachu` → `pikachu_2` se `pikachu.png` já for de outro.
async function livre(pasta, base, atual) {
  for (let n = 1; n < 100; n++) {
    const alvo = n === 1 ? `${base}.png` : `${base}_${n}.png`;
    if (alvo === atual || !(await existe(join(RAIZ, pasta, alvo)))) return alvo;
  }
  return `${base}_${Date.now()}.png`;
}

// Dois renames em voo ao mesmo tempo poderiam ambos achar `pikachu.png` livre e
// um sobrescrever o outro. Uma fila só resolve: o segundo enxerga o disco do primeiro.
let fila = Promise.resolve();
function enfileirar(fn) {
  const r = fila.then(fn, fn);
  fila = r.catch(() => {});
  return r;
}

function caminhoPngEntrada(e) {
  const pasta = e.pasta || '';
  return join(RAIZ, pasta, posix.basename(e.arquivo));
}

function dimensoesPngEsperadas(e) {
  if (!e.manifest || !e.width || !e.height) return null;
  const fw = e.width * 32;
  const fh = e.height * 32;
  const rows = e.frames || 1;
  return { w: fw * 4, h: fh * rows };
}

async function dimensoesPngArquivo(file) {
  const buf = await readFile(file);
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function avisoAtlasDesatualizado(e, file) {
  const esperado = dimensoesPngEsperadas(e);
  if (!esperado) return null;
  const atual = await dimensoesPngArquivo(file);
  if (!atual) return null;
  if (atual.w === esperado.w && atual.h === esperado.h) return null;
  return `preview usa atlas antigo (${esperado.w}×${esperado.h}) · PNG no disco é ${atual.w}×${atual.h}`;
}

async function revelarNoExplorer({ id }) {
  await garantirIndice();
  const e = indice.outfits[String(id)];
  if (!e) return { erro: 'id desconhecido' };
  const file = caminhoPngEntrada(e);
  try {
    await stat(file);
  } catch {
    return { erro: `PNG ausente: ${e.arquivo}` };
  }
  const aviso = await avisoAtlasDesatualizado(e, file);
  if (process.platform === 'win32') {
    spawn('explorer.exe', [`/select,${file}`], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', ['-R', file], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [dirname(file)], { detached: true, stdio: 'ignore' }).unref();
  }
  return { ok: true, caminho: file, aviso };
}

async function validarEntrada(id, e) {
  if (!e) return 'id desconhecido';
  if (Number(e.id) !== Number(id)) {
    return `índice corrompido (cartão ${id}, interno ${e.id}) — rode python tools/nomeador/reparar-indice.py e reinicie o Nomeador`;
  }
  const pasta = e.pasta || '';
  const png = join(RAIZ, pasta, posix.basename(e.arquivo));
  try {
    const buf = await readFile(png);
    const h = createHash('md5').update(buf).digest('hex').slice(0, 16);
    const esperado = String(e.chave || '').split('#')[0];
    if (esperado && h !== esperado) {
      return `PNG ${e.arquivo} não bate com o índice — Ctrl+Shift+R no browser`;
    }
  } catch {
    return `PNG ausente: ${e.arquivo}`;
  }
  return null;
}

async function renomear({ id, nome }) {
  await garantirIndice();
  const e = indice.outfits[String(id)];
  const inv = await validarEntrada(id, e);
  if (inv) return { erro: inv };

  const pasta = e.pasta || '';
  const atual = posix.basename(e.arquivo);
  // campo vazio = voltar ao nome original (o `outfit_N` que veio do dump)
  const base = nome.trim() ? limpar(nome) : posix.basename(e.origem || e.arquivo, '.png');
  if (!base) return { erro: 'nome vazio depois de limpar' };

  const alvo = await livre(pasta, base, atual);
  if (alvo !== atual) {
    await rename(join(RAIZ, pasta, atual), join(RAIZ, pasta, alvo));
    await appendFile(LOG, `${JSON.stringify({ t: new Date().toISOString(), id, de: e.arquivo, para: posix.join(pasta, alvo) })}\n`);
  }

  e.arquivo = pasta ? posix.join(pasta, alvo) : alvo;
  e.name = /^(outfit_\d+|boss_arena_.*)$/i.test(base) ? '' : base;
  e.nomeado = e.name !== '';
  e.kind = classificar(e, pasta);
  await salvar();
  cacheEspecies = null;
  return { ok: true, entrada: e };
}

// O X da carta: manda para `NP/`, a pasta de "não é pokémon para nomear" (fantasia
// de evento, montaria, treinador). Só sai da fila — nada é apagado, e o log guarda
// de onde veio, então voltar é um rename.
async function mover({ id, para }) {
  await garantirIndice();
  const e = indice.outfits[String(id)];
  const inv = await validarEntrada(id, e);
  if (inv) return { erro: inv };

  const destino = para ?? 'NP';
  if (!PASTAS.includes(destino)) return { erro: `pasta não permitida: ${destino}` };

  const origem = e.pasta || '';
  const atual = posix.basename(e.arquivo);
  if (origem === destino) return { ok: true, entrada: e };

  if (destino) await mkdir(join(RAIZ, destino), { recursive: true });
  const alvo = await livre(destino, posix.basename(atual, '.png'), null);
  await rename(join(RAIZ, origem, atual), join(RAIZ, destino, alvo));
  await appendFile(LOG, `${JSON.stringify({ t: new Date().toISOString(), id, de: e.arquivo, para: destino ? posix.join(destino, alvo) : alvo })}\n`);

  e.pasta = destino;
  e.arquivo = destino ? posix.join(destino, alvo) : alvo;
  e.kind = classificar(e, destino);
  await salvar();
  return { ok: true, entrada: e };
}

/** Persiste a ordem manual dos sprites numa pasta ou seção de geração. */
async function reordenar({ pasta, ger, ids }) {
  await garantirIndice();
  if (!Array.isArray(ids) || !ids.length) return { erro: 'lista de ids vazia' };
  const entradas = [];
  for (let i = 0; i < ids.length; i++) {
    const e = indice.outfits[String(ids[i])];
    if (!e) continue;
    e.ordem = (i + 1) * 10;
    if (ger) e.gerSecao = ger;
    entradas.push(e);
  }
  await salvar();
  return { ok: true, pasta: pasta || null, ger: ger || null, entradas };
}

// Lista de sugestões: as 482 espécies do jogo + tudo que já foi nomeado à mão.
async function sugestoes() {
  const nomes = new Set();
  for (const caminho of CREATURES) {
    try {
      const { creatures } = JSON.parse(await readFile(caminho, 'utf-8'));
      for (const c of creatures) {
        nomes.add(limpar(c.name));
        nomes.add(`shiny_${limpar(c.name)}`);
      }
      break;
    } catch { /* tenta o próximo caminho */ }
  }
  for (const e of Object.values(indice.outfits)) if (e.name) nomes.add(e.name);
  for (const f of [
    'shellos_west', 'shellos_east', 'gastrodon_west', 'gastrodon_east',
    'castform', 'castform_fire', 'castform_water', 'castform_ice',
    'pyroar_male', 'pyroar_female',
    'burmy', 'burmy_plant', 'burmy_sandy', 'burmy_trash',
    'wormadam', 'wormadam_plant', 'wormadam_sandy', 'wormadam_trash',
  ]) {
    nomes.add(f);
    nomes.add(`shiny_${f}`);
  }
  return [...nomes].sort();
}

async function lerJson(caminho, fallback = null) {
  try {
    return JSON.parse(await readFile(caminho, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function todasEspecies() {
  if (cacheEspecies) return cacheEspecies;

  const patches = (await lerJson(SPRITES_LAB))?.patches ?? [];
  const lookPorId = new Map(patches.map((p) => [p.pokeId, p.looktype]));
  const merge = [];
  for (const caminho of CREATURES_PATHS) {
    const data = await lerJson(caminho);
    if (data?.creatures) merge.push(...data.creatures);
  }
  for (const p of patches) {
    const c = merge.find((x) => x.pokeId === p.pokeId);
    if (c && p.looktype) c.looktype = p.looktype;
  }

  const porDexMerge = new Map();
  for (const c of merge) {
    const dex = c.pokeId < 1000 ? c.pokeId : c.pokeId % 1000;
    if (dex < 252) continue;
    let hit = porDexMerge.get(dex) ?? {
      dex,
      nome: c.name,
      type1: c.type1,
      type2: c.type2 ?? null,
      looktype: c.looktype ?? 1,
      rarity: c.rarity ?? null,
    };
    if (c.pokeId < 1000) {
      hit.pokeId = c.pokeId;
      hit.nome = c.name;
      hit.type1 = c.type1;
      hit.type2 = c.type2 ?? null;
      hit.looktype = lookPorId.get(c.pokeId) ?? c.looktype ?? hit.looktype;
    }
    if (c.pokeId >= 13000 && c.pokeId < 14000) {
      hit.pokeIdOrre = c.pokeId;
      hit.looktype = lookPorId.get(c.pokeId) ?? c.looktype ?? hit.looktype;
    }
    porDexMerge.set(dex, hit);
  }

  const { porDexNivel } = aplicarEscalaHuntLevel(merge, undefined, merge);
  const pokedex = montarPokedex(indice.outfits);

  /** Mesmo critério do Pokédex: sprite normal (lab ou espelho do jogo), uma linha por dex. */
  const porDexCat = new Map();
  for (const g of pokedex.geracoes) {
    if (g.max < 252) continue;
    for (const ent of g.entradas) {
      if (LENDARIO_DEX.has(ent.dex)) continue;
      if (!ent.normal) continue;
      const lista = porDexCat.get(ent.dex) ?? [];
      lista.push(ent);
      porDexCat.set(ent.dex, lista);
    }
  }

  const especies = [...porDexCat.entries()].map(([dex, ents]) => {
    const ent = ents.sort((a, b) => a.slug.length - b.slug.length || a.slug.localeCompare(b.slug))[0];
    const hit = porDexMerge.get(dex);
    return {
      dex,
      nome: hit?.nome ?? ent.nome,
      type1: hit?.type1 ?? 'NORMAL',
      type2: hit?.type2 ?? null,
      pokeId: hit?.pokeId ?? hit?.pokeIdOrre ?? dex,
      pokeIdOrre: hit?.pokeIdOrre ?? null,
      looktype: lookPorId.get(hit?.pokeId ?? hit?.pokeIdOrre ?? dex) ?? hit?.looktype ?? 1,
      huntLevel: porDexNivel.get(dex) ?? null,
      slug: ent.slug,
    };
  });

  especies.sort((a, b) => a.dex - b.dex || a.nome.localeCompare(b.nome));
  cacheEspecies = especies;
  return especies;
}

async function huntsComWalkgrid() {
  const [markers, walk] = await Promise.all([
    lerJson(join(JOGO, 'world/map-markers.json'), { hunts: [] }),
    lerJson(join(JOGO, 'world/walkgrids.json'), { hunts: {} }),
  ]);
  const grades = walk.hunts ?? walk;
  return (markers.hunts ?? [])
    .filter((m) => {
      const g = grades[m.slug];
      return g?.pontos?.length && g?.grid?.length;
    })
    .map((m) => ({ slug: m.slug, area: m.area, nome: m.name, looktype: m.looktype }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

async function spawnsFontes() {
  return (await huntsComWalkgrid())
    .filter((m) => m.area === 'kanto' || m.area === 'orre')
    .map(({ slug, area, nome }) => ({ slug, area, nome }));
}

const MAPAS_DIR = join(JOGO, 'site/assets/maps');

const MAPAS_CIDADES = ['cerulean', 'pewter', 'viridian', 'cassino'];

// `bonecos` NÃO é escrito aqui: sai de `shared/casas.mjs`, a mesma tabela que o jogo lê para
// montar a casa. É o que faz o editor cobrar exatamente os bonecos que a raridade usa — sem
// isso, mudar a escada no jogo deixaria o lab pedindo cinco marcações para uma casa que só
// põe uma de pé, e o erro só apareceria depois do build.
const TIERS_CASA = [
  { id: 'comum', rotulo: 'Comum', cor: '#9e9e9e' },
  { id: 'incomum', rotulo: 'Incomum', cor: '#66bb6a' },
  { id: 'rara', rotulo: 'Rara', cor: '#42a5f5' },
  { id: 'mitica', rotulo: 'Mítica', cor: '#ab47bc' },
  { id: 'lendaria', rotulo: 'Lendária', cor: '#ffa726' },
].map((t) => ({ ...t, bonecos: bonecosDaRaridade(t.id) }));

const REF_CENTRO = {
  mapa: 'cerulean',
  box: [-40, -28, 29, 17],
  inicio: { x: -3, y: -6 },
};

async function lerMapa(slug) {
  return lerJson(join(JOGO, `world/maps/${slug}.json`));
}

async function estadoCasas() {
  const doc = await lerJson(CASAS_EDITOR, {
    mapaPadrao: 'cerulean',
    regiaoLab: [-48, -34, 38, 22],
    tiers: {},
  });
  for (const t of TIERS_CASA) {
    if (!doc.tiers[t.id]) {
      doc.tiers[t.id] = {
        rotulo: t.rotulo,
        mapa: doc.mapaPadrao ?? 'cerulean',
        box: null,
        inicio: null,
        porta: null,
        passagens: {},
        escadas: { subir: [], descer: [] },
        bonecos: [],
      };
    }
    if (!Array.isArray(doc.tiers[t.id].bonecos)) doc.tiers[t.id].bonecos = [];
    doc.tiers[t.id].passagens = normalizarPassagensPorAndar(
      doc.tiers[t.id].passagens,
      7,
    );
    doc.tiers[t.id].escadas = normalizarEscadas(doc.tiers[t.id].escadas);
  }
  return doc;
}

async function groundZDoMapa(slug) {
  const m = await lerMapa(slug);
  return m?._meta?.groundZ ?? m?._meta?.range?.[4] ?? 7;
}

async function salvarCasas(doc) {
  const limpo = {
    _leia: doc._leia ?? 'Definições de casas — editado pelo lab Casas.',
    mapaPadrao: doc.mapaPadrao ?? 'cerulean',
    regiaoLab: doc.regiaoLab ?? [-48, -34, 38, 22],
    tiers: {},
  };
  for (const t of TIERS_CASA) {
    const src = doc.tiers?.[t.id] ?? {};
    const gz = await groundZDoMapa(src.mapa ?? limpo.mapaPadrao);
    limpo.tiers[t.id] = {
      rotulo: src.rotulo ?? t.rotulo,
      mapa: src.mapa ?? limpo.mapaPadrao,
      box: Array.isArray(src.box) && src.box.length === 4 ? src.box.map(Number) : null,
      inicio: src.inicio?.x != null ? { x: Number(src.inicio.x), y: Number(src.inicio.y) } : null,
      porta: src.porta?.x != null ? { x: Number(src.porta.x), y: Number(src.porta.y) } : null,
      passagens: normalizarPassagensPorAndar(src.passagens, gz),
      escadas: normalizarEscadas(src.escadas),
      // Onde ficam os BONECOS de treino da Academia, em coordenada LOCAL à caixa (a mesma
      // convenção das passagens). O jogo usa os N primeiros, e N é o `bonecos` daquela
      // raridade em `shared/casas.mjs` — hoje 1 em quatro delas e 2 na Lendária. Sobra fica
      // gravada e não atrapalha; falta deixa boneco sem lugar.
      bonecos: (Array.isArray(src.bonecos) ? src.bonecos : [])
        .filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
        .map(([x, y]) => [x | 0, y | 0]),
    };
  }
  const tmp = `${CASAS_EDITOR}.tmp`;
  await writeFile(tmp, JSON.stringify(limpo, null, 2), 'utf-8');
  await rename(tmp, CASAS_EDITOR);
  return { ok: true, arquivo: CASAS_EDITOR };
}

async function previewCasa({ mapa, box, inicio, incluirGrade = false, passagens = null, andar = null, escadas = null }) {
  const slug = String(mapa ?? 'cerulean').trim();
  const mapaJson = await lerMapa(slug);
  if (!mapaJson) return { erro: `mapa "${slug}" não encontrado — rode fetch-world` };
  const bloqueantes = await carregarBloqueantes(JOGO);
  const gz = mapaJson._meta?.groundZ ?? mapaJson._meta?.range?.[4] ?? 7;
  const fn = incluirGrade ? analisarAreaComGrade : analisarArea;
  return fn(mapaJson, bloqueantes, box, inicio ?? null, passagens, andar ?? gz, escadas);
}

async function estadoGinasios() {
  const doc = await lerJson(GINASIOS_EDITOR, {
    mapaPadrao: 'cerulean',
    regiaoLab: [-48, -34, 38, 22],
    arena: {},
  });
  const a = doc.arena ?? {};
  if (!a.mapa) a.mapa = doc.mapaPadrao ?? 'cerulean';
  if (!a.passagens) a.passagens = {};
  const gz = await groundZDoMapa(a.mapa ?? doc.mapaPadrao);
  a.passagens = normalizarPassagensPorAndar(a.passagens, gz);
  doc.arena = a;
  return doc;
}

async function salvarGinasios(doc) {
  const src = doc.arena ?? {};
  const mapaPadrao = doc.mapaPadrao ?? 'cerulean';
  const gz = await groundZDoMapa(src.mapa ?? mapaPadrao);
  const limpo = {
    _leia: doc._leia ?? 'Arena do desafio ao líder — editado pelo lab Ginásios.',
    mapaPadrao,
    regiaoLab: doc.regiaoLab ?? [-48, -34, 38, 22],
    arena: {
      mapa: src.mapa ?? mapaPadrao,
      box: Array.isArray(src.box) && src.box.length === 4 ? src.box.map(Number) : null,
      passagens: normalizarPassagensPorAndar(src.passagens, gz),
      desafiante: src.desafiante?.x != null
        ? { x: Number(src.desafiante.x), y: Number(src.desafiante.y) }
        : null,
      lider: src.lider?.x != null
        ? { x: Number(src.lider.x), y: Number(src.lider.y) }
        : null,
    },
  };
  const tmp = `${GINASIOS_EDITOR}.tmp`;
  await writeFile(tmp, JSON.stringify(limpo, null, 2), 'utf-8');
  await rename(tmp, GINASIOS_EDITOR);
  return { ok: true, arquivo: GINASIOS_EDITOR };
}

async function previewGinasio({ mapa, box, desafiante, incluirGrade = false, passagens = null, andar = null }) {
  return previewCasa({
    mapa,
    box,
    inicio: desafiante ?? null,
    incluirGrade,
    passagens,
    andar,
    escadas: null,
  });
}

function rodarWalkgrids() {
  const script = resolve(AQUI, '../build-walkgrids.mjs');
  const cwd = resolve(AQUI, '../..');
  return new Promise((ok, fail) => {
    const proc = spawn(process.execPath, [script], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    proc.stdout.on('data', (d) => { log += d; });
    proc.stderr.on('data', (d) => { log += d; });
    proc.on('close', (code) => {
      const linha = log.split('\n').find((l) => l.includes('ginasio-duelo'))?.trim() ?? '';
      if (code === 0) ok({ ok: true, log: linha || log.trim().slice(-400) });
      else fail(new Error(linha || log.trim().slice(-400) || `walkgrids exit ${code}`));
    });
  });
}

async function listarMapas() {
  try {
    const files = await readdir(MAPAS_DIR);
    return files
      .filter((f) => f.endsWith('.png') && f !== 'marker-atlas.png' && !f.startsWith('mapa_extra_'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

async function estadoMapas() {
  const editor = await lerJson(MAPAS_EDITOR, { porDex: {} });
  const spawns = await lerJson(SPAWNS_EDITOR, { regioes: {} });
  const porDex = { ...editor.porDex };
  for (const reg of Object.values(spawns.regioes ?? {})) {
    for (const m of reg.marcadores ?? []) {
      if (m.fonte) porDex[String(m.dex)] = m.fonte;
    }
  }
  return { editor, spawns, porDex };
}

async function salvarMapas(porDex) {
  const hunts = await huntsComWalkgrid();
  const slugsOk = new Set(hunts.map((h) => h.slug));
  const spawns = await lerJson(SPAWNS_EDITOR, { regioes: {} });
  const limpo = {};
  for (const [dexStr, fonte] of Object.entries(porDex ?? {})) {
    if (typeof fonte === 'string' && slugsOk.has(fonte)) limpo[dexStr] = fonte;
  }
  let atualizados = 0;
  for (const reg of Object.values(spawns.regioes ?? {})) {
    for (const marc of reg.marcadores ?? []) {
      const novo = limpo[String(marc.dex)] ?? null;
      if (marc.fonte !== novo) {
        marc.fonte = novo;
        atualizados++;
      }
    }
  }
  const tmpMapas = `${MAPAS_EDITOR}.tmp`;
  await writeFile(tmpMapas, JSON.stringify({ porDex: limpo }, null, 2), 'utf-8');
  await rename(tmpMapas, MAPAS_EDITOR);
  const tmpSp = `${SPAWNS_EDITOR}.tmp`;
  await writeFile(tmpSp, JSON.stringify(spawns, null, 2), 'utf-8');
  await rename(tmpSp, SPAWNS_EDITOR);
  return { ok: true, atualizados: Object.keys(limpo).length, marcadores: atualizados };
}

async function salvarSpawns(regiao, regiaoData) {
  const atual = await lerJson(SPAWNS_EDITOR, { regioes: {} });
  if (!atual.regioes[regiao]) return { erro: `região "${regiao}" desconhecida` };
  atual.regioes[regiao] = regiaoData;
  const tmp = `${SPAWNS_EDITOR}.tmp`;
  await writeFile(tmp, JSON.stringify(atual, null, 2), 'utf-8');
  await rename(tmp, SPAWNS_EDITOR);
  return { ok: true, marcadores: (regiaoData.marcadores ?? []).length };
}

let publicandoJogo = false;

async function publicarPokedexNoJogo(opts = {}) {
  if (publicandoJogo) return { erro: 'publicação já em andamento — aguarde terminar' };
  publicandoJogo = true;
  try {
    const log = [];
    const fonte = opts.fonte || 'backup';
    await publicarJogoNoDisco(({ passo, label, fase }) => {
      log.push({ passo, label, fase, t: Date.now() });
    }, { fonte });
    await carregar();
    cacheEspecies = null;
    return {
      ok: true,
      fonte,
      msg: fonte === 'backup'
        ? 'Sprites publicados a partir do Desktop/Pokedex Backup. Reinicie npm start se o jogo já estava aberto.'
        : 'Sprites no jogo local. Reinicie npm start se o servidor do jogo já estava aberto.',
      log,
    };
  } catch (e) {
    return {
      erro: String(e.message || e),
      passo: e.passo ?? null,
      detalhe: e.err || e.out || null,
    };
  } finally {
    publicandoJogo = false;
  }
}

async function backupPokedexNoDisco(geracao = 'all') {
  await garantirIndice();
  const r = await backupPokedex({
    outfits: indice.outfits,
    spritesRaiz: RAIZ,
    backupRaiz: POKEDEX_BACKUP,
    geracao,
  });
  const linhas = Object.entries(r.porGeracao)
    .map(([g, n]) => `gen ${g}: ${n}`)
    .join(' · ');
  return {
    ok: true,
    msg: `${r.copiados} PNGs → ${r.backupRaiz}${linhas ? ` (${linhas})` : ''}`,
    ...r,
    erros: r.erros.slice(0, 20),
  };
}

// ------------------------------------------------------------------ estáticos

async function servirArquivo(res, base, rel) {
  const file = join(base, normalize(rel));
  if (!file.startsWith(base)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('não é arquivo');
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`404 ${rel}`);
  }
}

const json = (res, obj, code = 200) =>
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(obj));

function corpo(req) {
  return new Promise((ok, err) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { err(e); } });
    req.on('error', err);
  });
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname);

  try {
    if (path === '/api/indice') {
      await garantirIndice();
      return json(res, indice);
    }
    if (path === '/api/nomes') return json(res, await sugestoes());
    if (path === '/api/geracoes') {
      await garantirIndice();
      const dex = carregarDex();
      return json(res, {
        faixas: FAIXAS,
        dex,
        stats: statsPorGeracao(indice.outfits, dex),
      });
    }
    if (path === '/api/pokedex') {
      await garantirIndice();
      return json(res, montarPokedex(indice.outfits));
    }
    if (path === '/api/pokedex-oficial') {
      try {
        return json(res, await montarPokedexOficial(POKEDEX_BACKUP));
      } catch (e) {
        return json(res, { erro: String(e.message || e) }, 500);
      }
    }
    if (path === '/api/pokedex/publicar' && req.method === 'POST') {
      const body = await corpo(req).catch(() => ({}));
      const fonte = body.fonte === 'lab' ? 'lab' : 'backup';
      const r = await publicarPokedexNoJogo({ fonte });
      return json(res, r, r.erro ? 500 : 200);
    }
    if (path === '/api/pokedex-oficial/publicar' && req.method === 'POST') {
      const r = await publicarPokedexNoJogo({ fonte: 'backup' });
      return json(res, r, r.erro ? 500 : 200);
    }
    if (path === '/api/pokedex/backup' && req.method === 'POST') {
      try {
        const body = await corpo(req).catch(() => ({}));
        const r = await backupPokedexNoDisco(body.geracao ?? 'all');
        return json(res, r);
      } catch (e) {
        return json(res, { erro: String(e.message || e) }, 500);
      }
    }
    // ECONOMIA — o grafo hunts → pokémon → itens com os preços de hoje e os propostos.
    // Recalcula a cada chamada (leitura de disco, ~1 s) para refletir edição de spawns
    // ou de creatures sem precisar reiniciar o servidor.
    if (path === '/api/economia') {
      return json(res, montarPainelEconomia());
    }
    if (path === '/api/moves') {
      try {
        return json(res, await montarPainelMoves());
      } catch (e) {
        return json(res, { erro: String(e.message || e) }, 500);
      }
    }
    if (path === '/api/moves/trampar') {
      try {
        return json(res, await escanearBibliotecaTrampar());
      } catch (e) {
        return json(res, { erro: String(e.message || e) }, 500);
      }
    }
    if (path === '/api/moves/tm-elemental') {
      try {
        if (req.method === 'POST') {
          const body = await corpo(req).catch(() => ({}));
          return json(res, await salvarTmElementalEfeitos(body));
        }
        return json(res, await carregarTmElementalEfeitos());
      } catch (e) {
        return json(res, { erro: String(e.message || e) }, 500);
      }
    }
    // Recalcula só a autonomia com as premissas da poção vindas da tela. É barato (não toca
    // no grafo, que fica em cache) e é o que deixa o controle responder na hora.
    if (path === '/api/economia/autonomia') {
      const frac = Number(url.searchParams.get('frac'));
      const cob = Number(url.searchParams.get('cobertura'));
      const opts = {};
      if (Number.isFinite(frac) && frac > 0 && frac <= 1) opts.frac = frac;
      if (Number.isFinite(cob) && cob > 0 && cob <= 1) opts.coberturaMin = cob;
      return json(res, {
        autonomia: autonomiaEconomia(undefined, opts),
        tetoPocao: nivelTetoPocao(opts.coberturaMin),
      });
    }
    if (path.startsWith('/api/economia/item/')) {
      const d = detalheItemEconomia(path.slice('/api/economia/item/'.length));
      return json(res, d ?? { erro: 'item não encontrado' }, d ? 200 : 404);
    }
    if (path.startsWith('/api/economia/especie/')) {
      const d = detalheEspecieEconomia(path.slice('/api/economia/especie/'.length));
      return json(res, d ?? { erro: 'espécie não encontrada' }, d ? 200 : 404);
    }
    // Agrupamento por silhueta (gerado por silhuetas.py, hoje sobre o acervo inteiro).
    // Opcional: sem o arquivo as telas só perdem a ordenação por semelhança.
    if (path === '/api/silhuetas') {
      try {
        return json(res, JSON.parse(await readFile(SILHUETAS, 'utf-8')));
      } catch {
        return json(res, { porId: {}, grupos: 0, ausente: true });
      }
    }
    if (path === '/api/nome' && req.method === 'POST') {
      const b = await corpo(req);
      const r = await enfileirar(() => renomear(b));
      return json(res, r, r.erro ? 400 : 200);
    }
    if (path === '/api/mover' && req.method === 'POST') {
      const b = await corpo(req);
      const r = await enfileirar(() => mover(b));
      return json(res, r, r.erro ? 400 : 200);
    }
    if (path === '/api/ordem' && req.method === 'POST') {
      const b = await corpo(req);
      const r = await enfileirar(() => reordenar(b));
      return json(res, r, r.erro ? 400 : 200);
    }
    if (path === '/api/reveal' && req.method === 'POST') {
      const b = await corpo(req);
      const r = await revelarNoExplorer(b);
      return json(res, r, r.erro ? 400 : 200);
    }
    if (path === '/api/spawns') {
      if (req.method === 'GET') {
        return json(res, await lerJson(SPAWNS_EDITOR, { regioes: {} }));
      }
      if (req.method === 'POST') {
        const b = await corpo(req);
        const r = await salvarSpawns(b.regiao, b.regiaoData);
        return json(res, r, r.erro ? 400 : 200);
      }
    }
    if (path === '/api/spawns/especies') {
      const lendariosPorGeracao = Object.fromEntries(
        FAIXAS.filter((f) => f.min >= 252).map((f) => [f.id, resumoLendarios(f.min, f.max)]),
      );
      return json(res, { especies: await todasEspecies(), lendariosPorGeracao });
    }
    if (path === '/api/spawns/mapas') {
      return json(res, { mapas: await listarMapas() });
    }
    if (path === '/api/spawns/fontes') {
      return json(res, { fontes: await spawnsFontes() });
    }
    if (path === '/api/mapas') {
      if (req.method === 'GET') {
        const { porDex } = await estadoMapas();
        const especies = await todasEspecies();
        const poolsDoc = await lerJson(MAPAS_POOLS, { pools: {}, tipoPorSlug: {} });
        const hunts = await huntsComWalkgrid();
        const tipoPorSlug = poolsDoc.tipoPorSlug ?? {};
        return json(res, {
          hunts: hunts.map((h) => ({ ...h, tipo: tipoPorSlug[h.slug] ?? null })),
          pools: poolsDoc.pools ?? {},
          seed: poolsDoc.seed ?? null,
          porDex,
          especies: especies.map((e) => ({
            ...e,
            fontePadrao: fontePorTipo(e.type2 ? `${e.type1}/${e.type2}` : e.type1),
          })),
        });
      }
      if (req.method === 'POST') {
        const b = await corpo(req);
        const r = await salvarMapas(b.porDex ?? {});
        return json(res, r, r.erro ? 400 : 200);
      }
    }
    if (path === '/api/casas') {
      if (req.method === 'GET') {
        const doc = await estadoCasas();
        return json(res, {
          ...doc,
          tierMeta: TIERS_CASA,
          mapasCidades: MAPAS_CIDADES,
          referencia: { centro: REF_CENTRO },
        });
      }
      if (req.method === 'POST') {
        const b = await corpo(req);
        const doc = await estadoCasas();
        if (b.mapaPadrao) doc.mapaPadrao = b.mapaPadrao;
        if (b.regiaoLab) doc.regiaoLab = b.regiaoLab;
        if (b.tiers) {
          for (const [id, incoming] of Object.entries(b.tiers)) {
            const base = doc.tiers[id] ?? {};
            doc.tiers[id] = {
              ...base,
              ...incoming,
              passagens: incoming.passagens ?? base.passagens,
              escadas: normalizarEscadas(incoming.escadas ?? base.escadas),
            };
          }
        }
        const r = await salvarCasas(doc);
        return json(res, r, r.erro ? 400 : 200);
      }
    }
    if (path === '/api/casas/preview' && req.method === 'POST') {
      const b = await corpo(req);
      const r = await previewCasa(b);
      return json(res, r, r.erro ? 400 : 200);
    }
    if (path === '/api/ginasios') {
      if (req.method === 'GET') {
        const doc = await estadoGinasios();
        return json(res, {
          ...doc,
          mapasCidades: MAPAS_CIDADES,
          referencia: { centro: REF_CENTRO },
        });
      }
      if (req.method === 'POST') {
        const b = await corpo(req);
        const doc = await estadoGinasios();
        if (b.mapaPadrao) doc.mapaPadrao = b.mapaPadrao;
        if (b.regiaoLab) doc.regiaoLab = b.regiaoLab;
        if (b.arena) {
          doc.arena = { ...doc.arena, ...b.arena };
          if (b.arena.passagens) doc.arena.passagens = b.arena.passagens;
        }
        const r = await salvarGinasios(doc);
        return json(res, r, r.erro ? 400 : 200);
      }
    }
    if (path === '/api/ginasios/preview' && req.method === 'POST') {
      const b = await corpo(req);
      const r = await previewGinasio(b);
      return json(res, r, r.erro ? 400 : 200);
    }
    if (path === '/api/ginasios/publicar-walkgrids' && req.method === 'POST') {
      try {
        const r = await rodarWalkgrids();
        return json(res, r);
      } catch (e) {
        return json(res, { ok: false, erro: String(e.message || e) }, 500);
      }
    }
    if (path === '/favicon.ico' || path === '/favicon.png') {
      return servirArquivo(res, FAVICON_DIR, 'favicon-32.png');
    }
    if (path === '/mapview.mjs') return servirArquivo(res, PUBLIC_GAME, 'mapview.mjs');
    if (path.startsWith('/assets/')) return servirArquivo(res, JOGO, path.slice('/assets/'.length));
    if (path.startsWith('/trampar/')) {
      return servirArquivo(res, tramparEfeitos(), path.slice('/trampar/'.length));
    }
    if (path.startsWith('/data/')) return servirArquivo(res, PUBLIC_GAME, path.slice(1));
    if (path.startsWith('/jogo/')) return servirArquivo(res, JOGO, path.slice(5));
    if (path.startsWith('/lab/')) return servirArquivo(res, LAB, path.slice(4));
    if (path.startsWith('/backup/')) {
      const rest = path.slice('/backup/'.length);
      const slash = rest.indexOf('/');
      if (slash > 0) {
        const genId = rest.slice(0, slash);
        const arquivo = rest.slice(slash + 1);
        const file = await caminhoArquivoBackup(POKEDEX_BACKUP, genId, arquivo);
        if (file) {
          try {
            const info = await stat(file);
            if (info.isFile()) {
              res.writeHead(200, {
                'content-type': 'image/png',
                'content-length': info.size,
                'cache-control': 'no-cache',
              });
              createReadStream(file).pipe(res);
              return;
            }
          } catch { /* 404 abaixo */ }
        }
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 backup');
      return;
    }
    if (path.startsWith('/png/')) return servirArquivo(res, RAIZ, path.slice(4));

    if (path.endsWith('/')) path += 'index.html';
    return servirArquivo(res, PUBLICO, path);
  } catch (e) {
    json(res, { erro: String(e && e.message || e) }, 500);
  }
});

servidor.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Porta ${PORT} já em uso. Rode: npm run nomeador:stop\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

try {
  await carregar();
} catch (e) {
  console.error('\n  Erro ao carregar lab-index:', e?.message || e, '\n');
  process.exit(1);
}
const total = Object.keys(indice.outfits).length;
const nomeados = Object.values(indice.outfits).filter((e) => e.nomeado).length;
servidor.listen(PORT, () => {
  console.log(`\n  Nomeador  →  http://localhost:${PORT}`);
  console.log(`  ${total} sprites · ${nomeados} nomeados · ${total - nomeados} na fila`);
  console.log(`  sprites em ${RAIZ}\n`);
});
