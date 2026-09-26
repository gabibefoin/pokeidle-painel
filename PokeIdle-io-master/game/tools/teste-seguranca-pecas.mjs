// AUDITORIA DE SEGURANÇA das peças numeradas — casas, XP Share e bicicletas — sem banco.
//
//     node tools/teste-seguranca-pecas.mjs
//
// Cada seção é uma tentativa de ataque, escrita do lado de quem tenta: número forjado, jsonb adulterado,
// anunciar e continuar usando, o mesmo pokémon em dois postos, mais casas em uso do que o teto. Duas
// seções no fim são FUZZ: milhares de ações aleatórias (anunciar, cancelar, vender, pôr em uso, guardar,
// escalar, equipar) conferindo depois de CADA uma as invariantes que não podem quebrar nunca:
//
//   · nenhuma casa em uso passa do teto, nenhuma anunciada está em uso, nenhuma casa de outro dono vale;
//   · quem recebe XP Share está na EQUIPE, num posto de casa EM USO, e num posto só;
//   · só há velocidade de bicicleta com a equipada NA MÃO — anunciada ou vendida, a pé.
//
// O que depende do fluxo do sim (a ordem "tira da mão → grava", a trava de cooldown) é conferido no
// fonte, como os outros testes de regra deste repositório fazem.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MAX_CASAS_EM_USO, bonecosDaRaridade } from '../src/shared/casas.mjs';
import {
  casasAtivas,
  casaAtivaPorId,
  casaNaMaoPorId,
  usarCasa,
  fixarCasasEmUso,
  registrarNoPosto,
  postoDoPokemon,
  limparXpShare,
  recebedoresXpShare,
  mexeuNoXpShare,
} from '../src/server/game/casas.mjs';
import {
  bicicletaEquipada,
  equiparBicicleta,
  fatorPassoBicicleta,
  bicicletaNaMaoPorId,
  equipadaGravada,
  resolverEquipadaLegada,
  bicicletasNaBolsa,
} from '../src/server/game/bicicletas.mjs';
import { BICICLETA_POR_RARIDADE } from '../src/server/game/itens-nossos.mjs';

let testes = 0;
let falhas = 0;
function ok(cond, nome, detalhe = '') {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}
const secao = (s) => console.log(`\n${s}`);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel) => readFileSync(join(raiz, rel), 'utf8').replace(/\r\n/g, '\n');
function trecho(src, inicio, fim) {
  const i = src.indexOf(inicio);
  if (i < 0) return '';
  const j = src.indexOf(fim, i + inicio.length);
  return src.slice(i, j < 0 ? undefined : j);
}
const antesDe = (src, a, b) => src.indexOf(a) >= 0 && src.indexOf(b) >= 0 && src.indexOf(a) < src.indexOf(b);

/** PRNG determinístico (mulberry32): a sequência de ataque é a mesma em toda execução. */
function prng(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const casa = (id, raridade, anunciada = false) => ({ id, raridade, anunciada, criadaEm: 0, criador: 'x' });
const bike = (id, raridade, anunciada = false) => ({ id, raridade, anunciada, criadaEm: 0, criador: 'x' });
/** Um jogador com equipe de cinco (1–5) e um no Depot (9). */
function jogador({ casas = [], bicicletas = [], automation = {} } = {}) {
  const pokemons = new Map();
  for (let id = 1; id <= 5; id++) pokemons.set(id, { id, slot: id - 1 });
  pokemons.set(9, { id: 9, slot: null });
  return { casas, bicicletas, automation: { ...automation }, xpShare: { porCasa: {}, legado: null }, pokemons };
}
const naEquipe = (p) => (id) => {
  const pk = p.pokemons.get(id);
  return !!pk && pk.slot != null;
};

const sim = ler('src/server/sim.mjs');
const mdbFonte = ler('src/server/market-db.mjs');

console.log('SEGURANÇA — casas, XP Share e bicicletas\n========================================');

// ============================================================== XP SHARE
secao('XP Share — pokémon anunciado no Mercado');
{
  const p = jogador({ casas: [casa(1, 'lendaria')] });
  registrarNoPosto(p, p.casas[0], 0, 3);
  ok(recebedoresXpShare(p).some((r) => r.pkId === 3), 'escalado, ele recebe');
  // `market.criar` tira o pokémon da memória antes de gravar o anúncio.
  p.pokemons.delete(3);
  ok(limparXpShare(p, naEquipe(p)) && postoDoPokemon(p, 3) === null && recebedoresXpShare(p).length === 0,
    'anunciado (fora da memória), o posto se esvazia e ele não recebe mais');
  const criar = trecho(sim, "if (m.tipo === 'pokemon') {", '\n      if (m.casaId != null) {');
  ok(antesDe(criar, 'p.pokemons.delete(pk.id);', 'await mdb.criarAnuncio('), 'no sim, o pokémon sai da memória ANTES do await do anúncio');
  const credito = trecho(sim, 'function creditarXpShare(p, ativoPk, xpDoAtivo) {', '\n}\n');
  ok(/const pk = p\.pokemons\.get\(r\.pkId\);\s*\n\s*\/\/[^\n]*\n\s*if \(!pk \|\| pk\.slot == null\) \{/.test(credito),
    'o crédito relê o pokémon a cada abate: anunciado, vendido ou no Depot não recebe (mesmo com a lista em cache)');
  ok(/if \(ativoPk && pk\.id === ativoPk\.id\) continue;/.test(credito), 'o pokémon de batalha nunca recebe a própria fatia');
  ok(/function snapshot\(p[\s\S]{0,700}if \(limparXpShareInvalido\(p\)\) marcarSujo\(p\);/.test(sim), 'e o pacote da tela limpa o posto morto');
}
{
  const p = jogador({ casas: [casa(1, 'rara')] });
  registrarNoPosto(p, p.casas[0], 0, 2);
  p.pokemons.get(2).slot = null; // foi para o Depot
  limparXpShare(p, naEquipe(p));
  ok(postoDoPokemon(p, 2) === null, 'pokémon que vai para o Depot sai do posto');
}

secao('XP Share — casa anunciada, guardada ou de outro dono');
{
  const p = jogador({ casas: [casa(1, 'mitica'), casa(2, 'lendaria')] });
  registrarNoPosto(p, p.casas[0], 0, 1);
  registrarNoPosto(p, p.casas[1], 0, 2);
  p.casas[0].anunciada = true;
  mexeuNoXpShare(p);
  ok(!recebedoresXpShare(p).some((r) => r.casaId === 1), 'casa anunciada não reparte XP');
  ok(casaAtivaPorId(p, 1) === null && casaNaMaoPorId(p, 1) === null, 'e nem em uso nem na mão ela está (não se escala, não se entra, não se anuncia de novo)');
  ok(usarCasa(p, 1, true).erro === 'casa.naoDisponivel', 'pôr em uso a casa anunciada é recusado');
  const criarCasa = trecho(sim, 'if (m.casaId != null) {', '// CAIXA DE FUNDADOR.');
  ok(antesDe(criarCasa, 'pararXpShareDaCasa(p, casa)', 'await mdb.criarAnuncio(') && antesDe(criarCasa, 'casa.anunciada = true;', 'await mdb.criarAnuncio('),
    'no sim, a casa solta os postos e sai da mão ANTES do await do anúncio');
  ok(criarCasa.includes("if (p.casa?.casaId === casa.id) return evento(p, { k: 'aviso', msg: 'casa.saiaParaAnunciar' });"),
    'não se anuncia a casa em que se está dentro');
}
{
  const p = jogador({ casas: [casa(1, 'comum'), casa(2, 'rara')], automation: { casasEmUso: [1] } });
  registrarNoPosto(p, p.casas[1], 0, 4); // escrita direta num posto de casa guardada (jsonb adulterado)
  ok(!recebedoresXpShare(p).some((r) => r.casaId === 2), 'posto escrito numa casa GUARDADA não reparte XP');
  ok(limparXpShare(p, naEquipe(p)) && !(2 in p.xpShare.porCasa), 'e a limpeza apaga o posto dela');
}
{
  const p = jogador({ casas: [casa(10, 'lendaria')] });
  for (const forjado of [11, '10abc', -10, 0, 1.5, '__proto__', [10], { id: 10 }, null, true]) {
    ok(casaNaMaoPorId(p, forjado)?.id !== 10 || forjado === 10 || String(forjado) === '10',
      `número de casa forjado ${JSON.stringify(forjado)} não acha a casa`);
  }
  ok(casaNaMaoPorId(p, 99) === null && usarCasa(p, 99, true).erro === 'casa.naoDisponivel', 'casa de outro dono (número que não está na lista) não entra em uso');
}

secao('XP Share — mesmo pokémon em dois postos, e Exp. Share segurado');
{
  const p = jogador({ casas: [casa(1, 'comum'), casa(2, 'mitica')] });
  // O sim recusa (casa.jaEmOutroPosto); aqui a escrita é forçada, como um jsonb adulterado.
  registrarNoPosto(p, p.casas[0], 0, 5);
  registrarNoPosto(p, p.casas[1], 0, 5);
  limparXpShare(p, naEquipe(p));
  ok(recebedoresXpShare(p).filter((r) => r.pkId === 5).length === 1, 'repetido à força, ele recebe de UM posto só (o de maior fatia)');
  const escolher = trecho(sim, "'xpshare.escolher': (p, m) => {", '\n  },');
  ok(/postoDoPokemon\(p, pedido, \{ casaId: casa\.id, slot \}\)/.test(escolher), 'xpshare.escolher recusa pokémon já escalado noutro posto');
  ok(escolher.includes('ehXpShareHeldItem(pk.heldItemId)') && escolher.includes('pk.slot == null'),
    'e recusa quem segura Exp. Share e quem está fora da equipe');
  const held = trecho(sim, "'xpshareheld.equipar': (p, m) => {", '\n  },');
  ok(held.includes('pokemonNoPostoCasa(p, pk.id)'), 'o Exp. Share segurado não entra em pokémon escalado numa casa (as duas fatias não somam)');
}

secao('Casas em uso — o teto não se fura');
{
  const casas = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => casa(id, 'lendaria'));
  const p = jogador({ casas, automation: { casasEmUso: [1, 2, 3, 4, 5, 6, 7, 8, 9] } });
  ok(casasAtivas(p).length === MAX_CASAS_EM_USO, `jsonb com 9 casas em uso: valem ${MAX_CASAS_EM_USO}`);
  ok(fixarCasasEmUso(p) && p.automation.casasEmUso.length === MAX_CASAS_EM_USO, 'e a carga grava a lista cortada no teto');
  ok(usarCasa(p, 6, true).erro === 'casa.limiteEmUso', 'pedir a sexta é recusado');
  for (let i = 0; i < 50; i++) usarCasa(p, 6 + (i % 4), true);
  ok(casasAtivas(p).length === MAX_CASAS_EM_USO, '50 pedidos seguidos não furam o teto');
  p.automation.casasEmUso = 'todas';
  ok(casasAtivas(p).length === MAX_CASAS_EM_USO, 'campo torto (texto) cai na escolha padrão, que também respeita o teto');
  const usar = trecho(sim, "'casa.usar': (p, m) => {", '\n  },');
  ok(usar.includes('usarCasa(p, casaId, usar)') && usar.includes('casa.saiaParaGuardar'), 'casa.usar passa pela regra e não guarda a casa em que se está');
}

// ============================================================== BICICLETAS
secao('Bicicleta — anunciar a equipada derruba a velocidade');
{
  const p = jogador({ bicicletas: [bike(7, 'lendaria'), bike(8, 'lendaria')] });
  ok(equiparBicicleta(p, 7).ok && fatorPassoBicicleta(p) === 2, 'Lendária #7 equipada: passo ×2');
  p.bicicletas[0].anunciada = true;
  ok(bicicletaEquipada(p) === null && fatorPassoBicicleta(p) === 1,
    'anunciada: a pé NA HORA — mesmo com outra Lendária (#8) na bolsa, que não é equipada sozinha');
  ok(equiparBicicleta(p, 7).erro === 'bicicleta.naoTem', 'e a anunciada não se equipa de novo enquanto está à venda');
  p.bicicletas[0].anunciada = false;
  ok(fatorPassoBicicleta(p) === 2, 'cancelou o anúncio: volta equipada');
  p.bicicletas.shift(); // vendida: saiu da lista do dono
  ok(bicicletaEquipada(p) === null && fatorPassoBicicleta(p) === 1, 'vendida: a pé, e o número guardado não vale mais nada');
  const criarBike = trecho(sim, 'if (m.bicicletaId != null) {', '\n      if (m.caixaId) {');
  ok(antesDe(criarBike, 'bici.anunciada = true;', 'await mdb.criarAnuncio('), 'no sim, a bicicleta sai da mão ANTES do await do anúncio');
  ok(antesDe(criarBike, 'atualizarVelocidadeNoCentro(p);', 'await mdb.criarAnuncio('), 'e a praça de Cerulean desacelera junto');
  const sinc = trecho(sim, "'casa.sincronizar': (p) => {", '\n  },');
  ok(/enfileirarEconomia\(p, \(\) => Promise\.all\(\[carregarCasas\(p\), carregarBicicletas\(p\)\]\)/.test(sinc),
    'abrir o modal relê casas e bicicletas PELA FILA: não devolve à mão a peça de um anúncio ainda gravando');
  const campo = /campo\.velocidade = p\.huntSlug && !p\.boss \? fatorPassoBicicleta\(p\) : 1;/.test(sim);
  ok(campo, 'na hunt a velocidade é relida a cada tick (e nunca vale na arena do boss)');
}

secao('Bicicleta — número forjado e jsonb adulterado');
{
  const p = jogador({ bicicletas: [bike(3, 'mitica'), bike(4, 'comum', true)] });
  for (const forjado of [99, 4, '3abc', -3, 0, 3.5, [3], { id: 3 }, true, 'mitica', Number.NaN, Number.POSITIVE_INFINITY, '']) {
    const r = equiparBicicleta(p, forjado);
    ok(!r.ok && p.automation.bicicletaEquipada == null && fatorPassoBicicleta(p) === 1,
      `equipar ${JSON.stringify(forjado)} é recusado (${r.erro}) e ninguém fica rápido`);
  }
  ok(equiparBicicleta(p, '3').ok && bicicletaEquipada(p)?.id === 3, 'o número como texto de dígitos ("3") é o mesmo 3');
  ok(equipadaGravada(['lendaria']) === null && equipadaGravada({ id: 3 }) === null && equipadaGravada(true) === null,
    'na carga, equipada torta no jsonb (array, objeto, booleano) vira a pé');
  ok(equipadaGravada(12) === 12 && equipadaGravada('rara') === 'rara' && equipadaGravada('divina') === null,
    'número e raridade (conta de antes da numeração) passam; raridade inventada não');
  const antes = { automation: { bicicletaEquipada: 'mitica' }, bicicletas: null };
  ok(!resolverEquipadaLegada(antes) && fatorPassoBicicleta(antes) === 1, 'antes das bicicletas chegarem do banco, a raridade antiga não dá velocidade');
  const leg = jogador({ bicicletas: [bike(20, 'lendaria', true), bike(21, 'rara')], automation: { bicicletaEquipada: 'lendaria' } });
  ok(resolverEquipadaLegada(leg) && leg.automation.bicicletaEquipada === null && fatorPassoBicicleta(leg) === 1,
    'a raridade antiga só vira número de bicicleta NA MÃO — a Lendária anunciada não conta');
  ok(bicicletaNaMaoPorId(p, 4) === null, 'bicicleta anunciada não está na mão');
  const eq = trecho(sim, "'bicicleta.equipar': (p, m) => {", '\n  },');
  ok(eq.startsWith("'bicicleta.equipar': (p, m) => {\n    if (!p.bicicletas) return;"), 'equipar antes de as bicicletas carregarem não faz nada');
  ok(antesDe(eq, 'INTERVALO_TROCA_BICICLETA_MS - agora()', 'equiparBicicleta(p, pedida)'), 'a espera de 5 minutos é conferida antes de equipar');
}

secao('Bicicleta — a quantidade não volta pela porta dos fundos');
{
  ok(bicicletasNaBolsa({ [BICICLETA_POR_RARIDADE.lendaria]: 2, 11: 5 }).length === 1, 'bicicleta-item na bolsa é encontrada para ser numerada');
  const criar = trecho(sim, "'market.criar': (p, m) => {", "'market.editar'");
  ok(criar.includes("if (ehItemBicicleta(item.id)) return evento(p, { k: 'aviso', msg: 'bicicleta.anuncieNumero' });"),
    'anunciar bicicleta como QUANTIDADE (itemId) é recusado — seria uma cópia fora do escrow');
  ok(criar.includes("if (ehItemCasa(item.id)) return evento(p, { k: 'aviso', msg: 'casa.anuncieNumero' });"), 'e casa também');
  ok(/if \(bicicletasNaBolsa\(p\.items\)\.length\) \{\s*\n\s*carregarBicicletas\(p\)/.test(sim), 'bicicleta dada pelo painel é numerada na hora');
  ok(/delete p\.items\[b\.itemId\];[\s\S]{0,200}await bicicletasDb\.converterBicicletasDaBolsa/.test(sim),
    'a bicicleta-item sai da memória ANTES do await da conversão (um flush no meio não a regrava)');
}

// ============================================================== MERCADO
secao('Mercado — escrow das peças numeradas no banco');
{
  ok(/UPDATE bicicletas SET anuncio_id = \$1\s+WHERE id = \$2 AND dono_id = \$3 AND anuncio_id IS NULL/.test(mdbFonte),
    'anunciar bicicleta: só do dono de AGORA e só se não estiver em outro anúncio');
  ok(/UPDATE casas SET anuncio_id = \$1\s+WHERE id = \$2 AND dono_id = \$3 AND anuncio_id IS NULL/.test(mdbFonte), 'a casa, igual');
  ok(/UPDATE bicicletas SET dono_id = \$1, anuncio_id = NULL WHERE id = \$2 AND anuncio_id = \$3/.test(mdbFonte),
    'a compra troca o dono só da bicicleta presa ÀQUELE anúncio');
  ok(mdbFonte.includes('UPDATE bicicletas SET anuncio_id = NULL WHERE id = ANY($1::bigint[])'), 'as varreduras de devolução soltam o escrow da bicicleta');
  ok(!trecho(mdbFonte, 'async function fecharParaDevolucao(', '\n}\n').includes('UPDATE players') &&
    /else if \(a\.bicicletaId\)[\s\S]*p\.items\[a\.itemId\] =/.test(trecho(sim, 'async function entregarDevolucoesAgora(p) {', '\n}\n')),
    'e nenhuma devolução soma bicicleta como quantidade');
  ok(/if \(Number\(a\.vendedor_id\) === compradorId\) throw new Error\('não dá para comprar o próprio anúncio'\);/.test(mdbFonte),
    'ninguém compra o próprio anúncio');
  ok((mdbFonte.match(/!caixaId && !casaId && !bicicletaId/g) ?? []).length === 2, 'peça numerada não empilha nem cai na trava de reanúncio do item');
}

// ============================================================== FUZZ
secao('Fuzz — 5.000 ações aleatórias nas casas e no XP Share');
{
  const rnd = prng(20260914);
  const rar = ['comum', 'incomum', 'rara', 'mitica', 'lendaria'];
  const p = jogador({ casas: Array.from({ length: 12 }, (_, i) => casa(i + 1, rar[i % 5])) });
  const quebras = [];
  const pick = (n) => Math.floor(rnd() * n);
  for (let passo = 0; passo < 5000 && quebras.length < 5; passo++) {
    if (p.casas.length < 3) p.casas.push(casa(100 + passo, rar[pick(5)])); // comprou uma casa
    const c = p.casas[pick(p.casas.length)];
    const acao = pick(9);
    if (acao === 0) usarCasa(p, c.id, true);
    else if (acao === 1) usarCasa(p, c.id, false);
    else if (acao === 2 && !c.anunciada && casaNaMaoPorId(p, c.id)) { // anunciar: solta os postos e sai da mão
      for (const slot of Object.keys(p.xpShare.porCasa[c.id] ?? {})) registrarNoPosto(p, c, Number(slot), null);
      c.anunciada = true;
      mexeuNoXpShare(p);
      fixarCasasEmUso(p);
    } else if (acao === 3 && c.anunciada) { c.anunciada = false; mexeuNoXpShare(p); } // cancelar
    else if (acao === 4 && c.anunciada) { p.casas = p.casas.filter((x) => x !== c); mexeuNoXpShare(p); fixarCasasEmUso(p); } // vendida
    else if (acao === 5) { // escalar pelo caminho do sim: casa em uso, pokémon da equipe, sem outro posto
      const alvo = casaAtivaPorId(p, c.id);
      const pk = 1 + pick(9);
      const slot = pick(2);
      if (alvo && slot < bonecosDaRaridade(alvo.raridade) && naEquipe(p)(pk) && !postoDoPokemon(p, pk, { casaId: alvo.id, slot })) {
        registrarNoPosto(p, alvo, slot, pk);
      }
    } else if (acao === 6) { const pk = p.pokemons.get(1 + pick(5)); if (pk) pk.slot = pk.slot == null ? pick(5) : null; } // equipe ↔ Depot
    else if (acao === 7) { // anunciou um pokémon — ou ele voltou (cancelou o anúncio)
      const id = 1 + pick(5);
      if (p.pokemons.has(id)) p.pokemons.delete(id);
      else p.pokemons.set(id, { id, slot: pick(5) });
    }
    else if (acao === 8) { p.automation.casasEmUso = [rnd() * 40 | 0, 'x', -1, ...p.casas.map((x) => x.id)]; } // jsonb adulterado

    limparXpShare(p, naEquipe(p)); // o snapshot limpa a cada pacote
    const emUso = casasAtivas(p);
    const ids = new Set(emUso.map((x) => x.id));
    if (emUso.length > MAX_CASAS_EM_USO) quebras.push(`passo ${passo}: ${emUso.length} casas em uso`);
    if (emUso.some((x) => x.anunciada)) quebras.push(`passo ${passo}: casa anunciada em uso`);
    if (emUso.some((x) => !p.casas.includes(x))) quebras.push(`passo ${passo}: casa que não é dele em uso`);
    const receb = recebedoresXpShare(p);
    if (receb.some((r) => !ids.has(r.casaId))) quebras.push(`passo ${passo}: XP de casa fora de uso`);
    if (receb.some((r) => !naEquipe(p)(r.pkId))) quebras.push(`passo ${passo}: XP para quem não está na equipe`);
    if (new Set(receb.map((r) => r.pkId)).size !== receb.length) quebras.push(`passo ${passo}: pokémon recebendo de dois postos`);
  }
  ok(!quebras.length, 'nenhuma invariante quebrou em 5.000 ações (teto, anunciada, dono, equipe, um posto só)', quebras.join(' | '));
}

secao('Fuzz — 5.000 ações aleatórias nas bicicletas');
{
  const rnd = prng(424242);
  const rar = ['comum', 'incomum', 'rara', 'mitica', 'lendaria'];
  const fator = { comum: 1.15, incomum: 1.25, rara: 1.5, mitica: 1.75, lendaria: 2 };
  let p = jogador({ bicicletas: Array.from({ length: 8 }, (_, i) => bike(i + 1, rar[i % 5])) });
  const quebras = [];
  const pick = (n) => Math.floor(rnd() * n);
  const forjados = [0, -1, 999, '7x', [1], { id: 1 }, true, 'lendaria', 2.5];
  for (let passo = 0; passo < 5000 && quebras.length < 5; passo++) {
    if (p.bicicletas.length < 3) p.bicicletas.push(bike(100 + passo, rar[pick(5)])); // comprou uma bicicleta
    const b = p.bicicletas[pick(p.bicicletas.length)];
    const acao = pick(7);
    if (acao === 0 && b) equiparBicicleta(p, b.id);
    else if (acao === 1) equiparBicicleta(p, null);
    else if (acao === 2 && b && !b.anunciada) b.anunciada = true; // anunciou
    else if (acao === 3 && b?.anunciada) b.anunciada = false; // cancelou
    else if (acao === 4 && b?.anunciada) p.bicicletas = p.bicicletas.filter((x) => x !== b); // vendida
    else if (acao === 5) equiparBicicleta(p, forjados[pick(forjados.length)]);
    else if (acao === 6) p = { ...p, automation: { ...p.automation, bicicletaEquipada: equipadaGravada(forjados[pick(forjados.length)]) } };

    const eq = bicicletaEquipada(p);
    const f = fatorPassoBicicleta(p);
    if (f > 1 && !eq) quebras.push(`passo ${passo}: rápido sem bicicleta equipada`);
    if (eq && (eq.anunciada || !p.bicicletas.includes(eq))) quebras.push(`passo ${passo}: equipada anunciada ou que não é dele`);
    if (eq && f !== fator[eq.raridade]) quebras.push(`passo ${passo}: velocidade ${f} ≠ a da ${eq.raridade}`);
  }
  ok(!quebras.length, 'nenhuma invariante quebrou em 5.000 ações (só há velocidade com a equipada na mão, e é a dela)', quebras.join(' | '));
}

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
