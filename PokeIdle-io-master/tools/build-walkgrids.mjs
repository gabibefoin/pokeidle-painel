// Extrai a ÁREA ANDÁVEL de cada mapa de hunt para um arquivo compacto.
//
// A regra é a do cliente deles (`walkable(tx, ty)` no bundle do jogo):
//
//   walkable = dentro do retângulo `_meta.walk`
//              E existe uma tile no andar do chão (z === groundZ)
//              E nem o chão nem nenhum item daquela tile está em collision.json
//
// Os mapas somam 238 MB — o servidor não pode abri-los no tick nem carregar os 347 na
// memória. Aqui isso vira uma grade de bits por hunt (~1 MB no total), que o sim carrega
// inteira no boot e consulta em O(1).
//
//   node tools/build-walkgrids.mjs
//   node tools/build-walkgrids.mjs abra pikachu     só esses (para depurar)
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT, save } from './lib.mjs';
import {
  analisarAreaComGrade,
  normalizarEscadas,
  normalizarPassagensPorAndar,
} from './nomeador/casas-walkgrid.mjs';
import { huntConfigEfetivo } from './hunt-config-merge.mjs';

const MAPAS = join(OUT, 'world/maps');
const t0 = Date.now();

const collision = JSON.parse(await readFile(join(OUT, 'world/collision.json'), 'utf8'));
const bloqueantes = new Set(collision.blocking ?? []);

const huntConfigs = JSON.parse(await readFile(join(OUT, 'world/hunt-configs.json'), 'utf8'));

/**
 * Áreas que NÃO são hunt: um recorte escolhido à mão de um mapa de cidade.
 *
 * A pesca do jogo original é assim — o cliente deles pede o slug `pesca`, que não tem mapa
 * próprio (`/game/maps/pesca.json` responde 404) nem entra no `map-markers`. O que existe é
 * um `hunt-config?slug=pesca` apontando para tiles do mapa de **Cerulean**: começo em
 * (9,−11) e dois pontos de peixe em (9,−12) e (8,−11) — o cais de tábuas ao lado da praia.
 *
 * A caixa daqui é a **coluna da beira** desse mesmo cais (x 5..17, y −22..−12): a faixa de
 * tábua fica em x ≤ 10 e o mar começa exatamente em x = 11, então quem pesca em (10,−17)
 * está de frente para a água com ela ocupando a metade direita da tela. Os pontos de peixe
 * ficam grudados nessa beira, e não espalhados pelo cais, para o pescador não sair andando.
 */
const AREAS_ESPECIAIS = {
  /**
   * Arena lendária — recorte pequeno do mapa `cruel_boss`. Herói e boss a um tile de distância
   * (`distCombate: 1`): entram já em alcance de combate.
   */
  lendario_boss: {
    mapa: 'cruel_boss',
    box: [-7, -2, 2, 7],
    inicio: [-3, 5],
    spawns: [{ x: -3, y: 4, pokeId: 377, fixo: true }],
  },

  /**
   * @deprecated Arenas antigas — mantidas só para grades já geradas.
   */
  cruel_boss: {
    mapa: 'cruel_boss',
    box: [-11, -6, 4, 9],
    inicio: [-3, 3],
    spawns: [{ x: -3, y: 0, pokeId: 73, fixo: true }],
  },

  /**
   * Ancient Aero — caverna de rocha pequena recortada do mapa `aerodactyl` (a hunt de Aerodactyl).
   * O `aero_boss.json` ainda responde 404 na origem; este recorte usa o chão rochoso real.
   */
  aero_boss: {
    mapa: 'aerodactyl',
    box: [-2, 6, 6, 14],
    inicio: { x: 2, y: 12 },
    spawns: [{ x: 2, y: 9, pokeId: 142, fixo: true }],
  },

  /**
   * A PRAÇA do Centro Pokémon — a única área do jogo em que os jogadores se veem sem brigar.
   *
   * A cena antiga era um recorte de 19×19 em volta da enfermeira, e ela fica DENTRO do prédio:
   * o balcão dela é uma sala de três tiles, fechada por parede em todos os lados (a porta não
   * existe no andar do chão). Servia para uma cena parada, mas não dá para andar em três
   * tiles — por isso a praça é a RUA em frente ao Centro, e a Joy vai para a calçada.
   *
   * A caixa foi escolhida à mão: 70×46 em volta do Centro Pokémon, 1.815 tiles andáveis
   * conectados — mais que qualquer hunt do jogo, e no mesmo peso de desenho da arena PvP
   * `dusclops` (22 mil sprites, canvas de 4,9 Mpx). A cidade inteira (144×92) daria 5.593
   * tiles, mas também 82 mil sprites e um canvas de 66 MB: o maior mapa do jogo, com risco
   * real de o navegador de celular não conseguir alocá-lo.
   *
   * Os dois "spawns" aqui não são pokémon: são as marcas de onde ficam a Enfermeira Joy e a
   * Chansey dela. Passam por `spawns` para nascerem da mesma fonte que o resto da grade, em
   * vez de virarem um par de coordenadas soltas no servidor que ninguém lembra de conferir
   * quando a caixa muda.
   *
   * As duas vão com `fixo`, que pula o encaixe na área conectada — e é o ponto: elas ficam
   * ATRÁS do balcão, na saleta de três tiles que o `city-npcs.json` marca como o posto da
   * enfermeira. Aquele pedaço não se conecta ao resto do chão (a porta não existe no andar
   * do chão), então sem `fixo` o encaixe as arrastaria para a calçada — que é onde elas
   * estavam antes, atrapalhando a passagem em vez de recepcionar quem chega.
   */
  centro: {
    mapa: 'cerulean',
    box: [-40, -28, 29, 17],
    inicio: [-3, -6],
    spawns: [
      { x: -3, y: -10, pokeId: 0, fixo: true, cura: true }, // Enfermeira Joy, atrás do balcão
      { x: -2, y: -10, pokeId: 113, fixo: true }, // a Chansey dela, ao lado
      { x: 1, y: -6, pokeId: 0, tm: true }, // TM Researcher, calçada direita da entrada
      { x: -7, y: -6, pokeId: 0, depot: true }, // Depot, calçada esquerda da entrada
    ],
  },

  pesca: {
    mapa: 'cerulean',
    box: [5, -22, 17, -12],
    inicio: [10, -17],
    // onde o peixe fisgado cai — a fileira colada na água (o pokeId vem do tier, por isso 0)
    spawns: [
      { x: 10, y: -16, pokeId: 0 },
      { x: 10, y: -18, pokeId: 0 },
      { x: 10, y: -15, pokeId: 0 },
      { x: 10, y: -19, pokeId: 0 },
    ],
  },
};

const pedidos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const slugs = pedidos.length
  ? pedidos
  : (await readdir(MAPAS)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

console.log(`Extraindo a área andável de ${slugs.length} mapas → world/walkgrids.json\n`);

const hunts = {};
const problemas = [];
let feitos = 0;

/**
 * Recorta uma área andável de um mapa já carregado.
 *
 * @param mapa   o JSON de tiles
 * @param caixa  [minTx, minTy, maxTx, maxTy] — `_meta.walk` na hunt, escolhida à mão na área especial
 * @param start  {x,y} em tile de mapa, ou null para pegar a tile livre mais central
 * @param spawns [{x,y,pokeId}] em tile de mapa
 */
function recortarArea(mapa, caixa, start, spawns, opcoes = {}) {
  const meta = mapa._meta ?? {};
  const groundZ = meta.groundZ ?? meta.range?.[4] ?? 7;
  // O andar a recortar. Hunts e áreas especiais usam o chão do mapa; as CASAS podem pedir
  // outro (o interior de uma casa de dois andares mora em z=6, por exemplo).
  const z = Number.isFinite(opcoes.z) ? opcoes.z : groundZ;
  const [minTx, minTy, maxTx, maxTy] = caixa;
  const cols = maxTx - minTx + 1;
  const rows = maxTy - minTy + 1;

  // Uma linha de bytes por linha de tile; 1 = dá para pisar.
  const grade = Array.from({ length: rows }, () => new Uint8Array(cols));
  for (const t of mapa.tiles) {
    if (t[2] !== z) continue;
    const cx = t[0] - minTx;
    const cy = t[1] - minTy;
    if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
    const travado = bloqueantes.has(t[3]) || t[4].some((it) => bloqueantes.has(it[0]));
    grade[cy][cx] = travado ? 0 : 1;
  }

  /**
   * As PASSAGENS do lab de casas: correções feitas à mão por cima da colisão do mapa.
   *
   * O interior de uma casa de Cerulean nunca foi feito para ser andado — é cenário visto de
   * fora. Há parede que o `collision.json` não marca (e que precisa FECHAR, senão o pokémon
   * atravessa a casa do vizinho) e vão de porta que ele marca (e que precisa ABRIR, senão o
   * cômodo dos fundos fica inalcançável). Quem desenha isso é a aba Casas do nomeador, uma
   * tile por vez, e as coordenadas são LOCAIS à caixa — vêm assim do editor.
   *
   * Ordem: abrir e depois fechar. Fechar ganha em caso de conflito, que é o lado seguro —
   * uma tile aberta por engano deixa o boneco andar para fora da casa.
   */
  const pass = opcoes.passagens;
  if (pass) {
    for (const [x, y] of pass.abrir ?? []) {
      if (y >= 0 && y < rows && x >= 0 && x < cols) grade[y][x] = 1;
    }
    for (const [x, y] of pass.fechar ?? []) {
      if (y >= 0 && y < rows && x >= 0 && x < cols) grade[y][x] = 0;
    }
  }

  // A caixa do jogo inclui pedaços soltos (telhados, ilhas atrás de parede). O que vale é o
  // pedaço CONECTADO ao ponto de entrada da hunt — é lá que o servidor solta herói e mobs.
  const dentro = (x, y) => x >= 0 && x < cols && y >= 0 && y < rows;
  const livre = (x, y) => dentro(x, y) && grade[y][x] === 1;

  /** Tile andável mais próxima de (x,y), em anéis — mesma busca do `teleportTo` deles. */
  const encaixar = (x, y, raio = 8) => {
    if (livre(x, y)) return { x, y };
    for (let r = 1; r <= raio; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (livre(x + dx, y + dy)) return { x: x + dx, y: y + dy };
        }
      }
    }
    return null;
  };

  const inicioBruto = start ? { x: start.x - minTx, y: start.y - minTy } : null;
  let inicio = inicioBruto ? encaixar(inicioBruto.x, inicioBruto.y) : null;
  if (!inicio) {
    // sem `start` utilizável: pega a tile livre mais central
    let melhor = null;
    let melhorD = Infinity;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grade[y][x] !== 1) continue;
        const d = (x - cols / 2) ** 2 + (y - rows / 2) ** 2;
        if (d < melhorD) {
          melhorD = d;
          melhor = { x, y };
        }
      }
    }
    inicio = melhor;
  }

  let andaveis = 0;
  if (inicio) {
    // Inundação a partir do início; o que não for alcançado sai da grade.
    const alcancado = Array.from({ length: rows }, () => new Uint8Array(cols));
    const fila = [inicio.x, inicio.y];
    alcancado[inicio.y][inicio.x] = 1;
    for (let i = 0; i < fila.length; i += 2) {
      const x = fila[i];
      const y = fila[i + 1];
      andaveis++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (livre(nx, ny) && !alcancado[ny][nx]) {
          alcancado[ny][nx] = 1;
          fila.push(nx, ny);
        }
      }
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) grade[y][x] = alcancado[y][x];
  }

  // Pontos de spawn, já encaixados na área conectada. `fixo` pula o encaixe: é o caso do
  // boss que fica na água, onde a tile andável mais próxima seria a margem errada.
  const pontos = [];
  for (const s of spawns ?? []) {
    const p = s.fixo ? { x: s.x - minTx, y: s.y - minTy } : encaixar(s.x - minTx, s.y - minTy);
    if (p && p.x >= 0 && p.x < cols && p.y >= 0 && p.y < rows) {
      const tag = s.depot ? 'depot' : s.tm ? 'tm' : s.cura ? 'cura' : s.boneco ? 'boneco' : '';
      pontos.push(tag ? [p.x, p.y, s.pokeId, tag] : [p.x, p.y, s.pokeId]);
    }
  }

  return {
    box: [minTx, minTy, maxTx, maxTy],
    groundZ,
    center: meta.center ?? [0, 0],
    inicio: inicio ? [inicio.x, inicio.y] : [0, 0],
    andaveis,
    pontos,
    // uma string de '0'/'1' por linha: legível, e o gzip do servidor come isto muito bem
    grid: grade.map((linha) => Array.from(linha, (v) => (v ? '1' : '0')).join('')),
  };
}

/** Mapas que existem só para servir de área especial — a arena do boss é um deles. */
const SO_ESPECIAL = new Set(Object.values(AREAS_ESPECIAIS).map((a) => a.mapa));

for (const slug of slugs) {
  // A arena entra pelo bloco de áreas especiais, com caixa e spawn escolhidos à mão. Se
  // passasse por aqui também, geraria uma segunda entrada sem ponto de spawn nenhum.
  if (SO_ESPECIAL.has(slug) && !huntConfigs[slug]) continue;

  let mapa;
  try {
    mapa = JSON.parse(await readFile(join(MAPAS, `${slug}.json`), 'utf8'));
  } catch (err) {
    problemas.push({ slug, erro: `mapa não baixado (${err.code ?? err.message})` });
    continue;
  }

  const caixa = mapa._meta?.walk;
  if (!Array.isArray(caixa) || caixa.length !== 4) {
    problemas.push({ slug, erro: 'mapa sem _meta.walk' });
    continue;
  }

  const cfg = huntConfigEfetivo(huntConfigs, slug);
  const area = recortarArea(mapa, caixa, cfg.start ?? null, cfg.spawns ?? []);

  if (!area.andaveis) problemas.push({ slug, erro: 'nenhuma tile andável' });
  else if (!area.pontos.length && (cfg.spawns ?? []).length) {
    problemas.push({ slug, erro: 'spawns fora da área conectada' });
  }

  hunts[slug] = area;

  feitos++;
  if (feitos % 10 === 0 || feitos === slugs.length) {
    process.stdout.write(`\r  grades  ${String(Math.round((feitos / slugs.length) * 100)).padStart(3)}%  (${feitos}/${slugs.length})   `);
  }
}

process.stdout.write('\n');

// --------------------------------------------------------- áreas especiais
//
// Entram sempre, mesmo num build parcial (`node tools/build-walkgrids.mjs abra`): sem a
// grade da pesca o servidor simplesmente não tem onde pescar, e o modo some sem aviso.

for (const [nome, esp] of Object.entries(AREAS_ESPECIAIS)) {
  try {
    const mapa = JSON.parse(await readFile(join(MAPAS, `${esp.mapa}.json`), 'utf8'));
    const area = recortarArea(mapa, esp.box, { x: esp.inicio[0], y: esp.inicio[1] }, esp.spawns);
    if (!area.andaveis) throw new Error('nenhuma tile andável na caixa escolhida');
    if (area.pontos.length !== esp.spawns.length) throw new Error('ponto de spawn fora da área conectada');
    // Numa hunt o nome da área É o nome do mapa; aqui não — "pesca" é um recorte de
    // `cerulean.json`. Sem este campo o cliente pede /world/maps/pesca.json e não acha nada.
    hunts[nome] = { mapa: esp.mapa, ...area };
    console.log(`  área especial "${nome}" (${esp.mapa}): ${area.andaveis} tiles, ${area.pontos.length} pontos`);
  } catch (err) {
    problemas.push({ slug: nome, erro: `área especial: ${err.message}` });
  }
}

// ------------------------------------------------------------------ casas
//
// As cinco CASAS: interiores recortados de Cerulean, desenhados na aba Casas do nomeador
// (`npm run nomeador` → /casas.html) e gravados em `game/src/server/dados/casas-editor.json`.
//
// Por que elas não estão em `AREAS_ESPECIAIS` acima: as outras áreas especiais são caixas
// escritas à mão NESTE arquivo, e as casas são conteúdo EDITADO — box, spawn, passagens e a
// posição de cada boneco de treino saem da interface, não do código. Ler o JSON do editor é o
// que permite mexer numa casa sem mexer no build.
//
// Duas coisas que só as casas precisam, e que por isso viraram opções do `recortarArea`:
//
//   · **passagens** — parede e porta corrigidas à mão. Interior de casa em Cerulean é
//     cenário visto de fora; a colisão do mapa não descreve um lugar andável (ver o bloco
//     de `passagens` lá em cima).
//   · **andar** — a Lendária (e a Mítica) têm dois pavimentos no editor. Quem tem `escadas`
//     ganha um walkgrid por andar Z em `andares`, além do térreo em `grid`. O jogo troca de
//     andar ao pisar na escada (ver `casa-sala.mjs` e `campo.mjs` no cliente).
//
// O nome da área é `casa-<tier>` (`casa-comum`, `casa-lendaria`…) — é por ele que o servidor
// pede a grade em `gradeDaHunt`.
const bloqueantesCasas = bloqueantes;

function camadaWalkgridDePreview(preview, pontos = []) {
  const [minTx, minTy] = preview.box;
  const inicioLocal = preview.inicio
    ? [preview.inicio.x - minTx, preview.inicio.y - minTy]
    : [0, 0];
  return {
    grid: preview.alcancado.map((row) => row.map((v) => (v ? '1' : '0')).join('')),
    inicio: inicioLocal,
    andaveis: preview.conectados,
    pontos,
  };
}

const CASAS_EDITOR = join(OUT, '..', '..', 'game/src/server/dados/casas-editor.json');
try {
  const doc = JSON.parse(await readFile(CASAS_EDITOR, 'utf8'));
  for (const [tier, def] of Object.entries(doc.tiers ?? {})) {
    const nome = `casa-${tier}`;
    if (!Array.isArray(def.box) || def.box.length !== 4) {
      problemas.push({ slug: nome, erro: 'casa sem box no editor — desenhe na aba Casas' });
      continue;
    }
    try {
      const mapa = JSON.parse(await readFile(join(MAPAS, `${def.mapa ?? doc.mapaPadrao ?? 'cerulean'}.json`), 'utf8'));
      const groundZ = mapa._meta?.groundZ ?? mapa._meta?.range?.[4] ?? 7;
      const passagensPorAndar = normalizarPassagensPorAndar(def.passagens ?? {}, groundZ);
      const escadas = normalizarEscadas(def.escadas);
      const temEscadas = escadas.subir.length > 0 || escadas.descer.length > 0;
      const pontosBoneco = (def.bonecos ?? []).map(([x, y]) => [x, y, 0, 'boneco']);

      // Mesma função do nomeador (`/api/casas/preview`) — evita drift entre editor e jogo.
      const terreo = analisarAreaComGrade(
        mapa, bloqueantesCasas, def.box, def.inicio ?? null, def.passagens ?? {}, groundZ, def.escadas,
      );
      if (terreo.erro) throw new Error(terreo.erro);
      if (!terreo.conectados) throw new Error('nenhuma tile andável — confira as passagens no editor');

      const camadaTerreo = camadaWalkgridDePreview(terreo, pontosBoneco);
      const meta = mapa._meta ?? {};
      const [minTx, minTy, maxTx, maxTy] = def.box;

      const entrada = {
        mapa: def.mapa ?? doc.mapaPadrao ?? 'cerulean',
        box: [minTx, minTy, maxTx, maxTy],
        groundZ,
        center: meta.center ?? [0, 0],
        ...camadaTerreo,
      };

      if (temEscadas) {
        const andares = {};
        for (const zStr of Object.keys(passagensPorAndar)) {
          const z = Number(zStr);
          if (!Number.isFinite(z)) continue;
          const preview = analisarAreaComGrade(
            mapa, bloqueantesCasas, def.box, def.inicio ?? null, def.passagens ?? {}, z, def.escadas,
          );
          if (preview.erro || !preview.conectados) continue;
          andares[zStr] = camadaWalkgridDePreview(
            preview,
            z === groundZ ? pontosBoneco : [],
          );
        }
        entrada.escadas = escadas;
        entrada.andares = andares;
      }

      hunts[nome] = entrada;
      const andaresTxt = temEscadas ? ` · ${Object.keys(entrada.andares ?? {}).length} andar(es)` : '';
      console.log(
        `  casa "${tier}": ${camadaTerreo.andaveis} tiles, ${camadaTerreo.pontos.length} boneco(s)${andaresTxt}`
          + `${pontosBoneco.length !== camadaTerreo.pontos.length ? ` (${pontosBoneco.length - camadaTerreo.pontos.length} fora da caixa!)` : ''}`,
      );
    } catch (err) {
      problemas.push({ slug: nome, erro: `casa: ${err.message}` });
    }
  }
} catch (err) {
  console.log(`  (sem casas-editor.json: ${err.code ?? err.message} — as Casas ficam indisponíveis)`);
}

// ------------------------------------------------------------------ ginásio (duelo)
//
// A arena do desafio ao líder — recorte de Cerulean (ou outra cidade) desenhado na aba
// Ginásios do nomeador (`/ginasios.html`) → `ginasios-editor.json`.
const GINASIOS_EDITOR = join(OUT, '..', '..', 'game/src/server/dados/ginasios-editor.json');
try {
  const doc = JSON.parse(await readFile(GINASIOS_EDITOR, 'utf8'));
  const def = doc.arena ?? {};
  const nome = 'ginasio-duelo';
  if (!Array.isArray(def.box) || def.box.length !== 4) {
    console.log('  (ginasio-duelo: sem box no editor — desenhe na aba Ginásios)');
  } else {
    const mapaSlug = def.mapa ?? doc.mapaPadrao ?? 'cerulean';
    const mapa = JSON.parse(await readFile(join(MAPAS, `${mapaSlug}.json`), 'utf8'));
    const groundZ = mapa._meta?.groundZ ?? mapa._meta?.range?.[4] ?? 7;
    const passagensPorAndar = normalizarPassagensPorAndar(def.passagens ?? {}, groundZ);
    const terreo = analisarAreaComGrade(
      mapa, bloqueantesCasas, def.box, def.desafiante ?? null, def.passagens ?? {}, groundZ, null,
    );
    if (terreo.erro) throw new Error(terreo.erro);
    if (!terreo.conectados) throw new Error('nenhuma tile andável — confira passagens no editor');

    const [minTx, minTy] = def.box.map(Number);
    const pontos = [];
    const addSpawn = (pt, tag) => {
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
      pontos.push([pt.x - minTx, pt.y - minTy, 0, tag]);
    };
    addSpawn(def.desafiante, 'gin-a');
    addSpawn(def.lider, 'gin-b');

    const camada = camadaWalkgridDePreview(terreo, pontos);
    const meta = mapa._meta ?? {};
    hunts[nome] = {
      mapa: mapaSlug,
      box: def.box.map(Number),
      groundZ,
      center: meta.center ?? [0, 0],
      ...camada,
    };
    console.log(
      `  ginasio-duelo: ${camada.andaveis} tiles · spawns ${pontos.length}/2`
        + `${pontos.length < 2 ? ' (marque desafiante e líder no editor!)' : ''}`,
    );
  }
} catch (err) {
  if (err.code !== 'ENOENT') {
    problemas.push({ slug: 'ginasio-duelo', erro: `ginásio: ${err.message}` });
  } else {
    console.log(`  (sem ginasios-editor.json: ${err.message})`);
  }
}

const payload = { gerado: new Date().toISOString(), hunts };
const buf = Buffer.from(JSON.stringify(payload));
await save('world/walkgrids.json', buf);

const total = Object.values(hunts).reduce((s, h) => s + h.andaveis, 0);
console.log(
  `\nPronto em ${((Date.now() - t0) / 1000).toFixed(1)}s — ${Object.keys(hunts).length} hunts, ` +
    `${total.toLocaleString('pt-BR')} tiles andáveis, ${(buf.byteLength / 1024 / 1024).toFixed(2)} MB.`,
);
if (problemas.length) {
  console.log(`${problemas.length} com ressalva:`);
  for (const p of problemas.slice(0, 12)) console.log(`  · ${p.slug}: ${p.erro}`);
}
