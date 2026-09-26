// Teste do passo da bicicleta na praça de Cerulean, da troca de bicicleta e do aviso de drop
// Lendário no chat — sem banco e sem Redis.
//
// O nome ficou de quando a CASA também se equipava. Desde as casas numeradas todas valem ao mesmo
// tempo e não há o que equipar; as regras delas moram em `tools/teste-casas.mjs`. Daqui sobraram
// só as guardas de que a casa equipada não voltou por nenhum lado.
//
// O que este teste protege:
//   · raridade de casa só aceita id de verdade — texto adulterado, número e `__proto__` saem;
//   · no sim: a bicicleta só troca uma vez a cada 5 minutos, com o instante gravado na conta (sair e
//     entrar não zera); repetir a bicicleta equipada não manda estado; a casa equipada, a espera de
//     troca de casa e a trava de "uma casa por vez" não voltaram;
//   · o drop Lendário: sai só dos dois sorteios, só para a Lendária, só no chat MUNDO, sem aviso na
//     tela, e o campo sobrevive ao histórico do chat;
//   · o passo na praça: com bicicleta a velocidade média é a dela (o tick de 100 ms arredondava
//     toda bicicleta abaixo da Lendária para o passo a pé), cada passo começa na tela onde o
//     anterior termina, nenhum começa no passado do tick que o mandou, a tela nunca fica mais que
//     a folga atrás, e a pé e a Lendária seguem o passo de sempre — também com o `setInterval`
//     atrasando, com o tick chegando um triz antes da conta e trocando de bicicleta no meio;
//   · nenhum cliente adulterado anda mais rápido: trocando de bicicleta e soltando a tecla a
//     cada tick, nenhum passo começa antes do fim do anterior e nenhum segundo passa do teto;
//   · o aviso de "anunciando por Coins" vale para todo anúncio (pokémon, item e diamante);
//   · toda chave de texto que sobrou existe nas três línguas, e as da regra antiga saíram.
//
//   node tools/teste-casa-equipar.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RARIDADES_CASA } from '../src/shared/casas.mjs';
import { RARIDADES_BICICLETA, fatorPassoDaRaridade, passoComBicicleta } from '../src/shared/bicicletas.mjs';
import { raridadeCasaValida } from '../src/server/game/casas.mjs';
import { INTERVALO_TROCA_BICICLETA_MS } from '../src/server/game/bicicletas.mjs';
import {
  passoNoRitmo,
  podeDarPasso,
  paradoNaPraca,
  MS_PASSO,
  TICK_MS,
  FOLGA_RITMO_MS,
  TOLERANCIA_TICK_MS,
} from '../src/server/game/centro.mjs';
import { _dicionarios } from '../src/client/i18n.mjs';

let testes = 0;
let falhas = 0;
function ok(cond, nome, detalhe = '') {
  testes++;
  if (cond) return console.log(`  ok  ${nome}`);
  falhas++;
  console.log(`  FALHOU  ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel) => readFileSync(join(raiz, rel), 'utf8').replace(/\r\n/g, '\n');
/** Um pedaço do fonte: de `inicio` até o primeiro `fim` depois dele. */
function trecho(src, inicio, fim) {
  const i = src.indexOf(inicio);
  if (i < 0) return '';
  const j = src.indexOf(fim, i + inicio.length);
  return src.slice(i, j < 0 ? undefined : j);
}
const mostrar = (v) => JSON.stringify(v) ?? String(v);

// ------------------------------------------------------------------ a casa

console.log('\n— raridade da casa');
for (const r of RARIDADES_CASA) ok(raridadeCasaValida(r.id) === r.id, `"${r.id}" passa`);
for (const torto of ['LENDARIA', 'lendaria ', '', '__proto__', 'constructor', 'toString', 0, 7, null, undefined, {}, ['lendaria'], true]) {
  ok(raridadeCasaValida(torto) === null, `adulterada recusada: ${mostrar(torto)}`);
}

// ------------------------------------------------------------------- o sim

console.log('\n— o sim');
{
  const sim = ler('src/server/sim.mjs');
  ok(!sim.includes("'casa.equipar'") && !sim.includes('INTERVALO_TROCA_CASA_MS') && !sim.includes('casaTrocadaEm'),
    'a casa equipada e a espera de troca de casa não voltaram');
  ok(!/temCasaInventario|casaMantida|uma casa por vez|uma na bolsa por vez|Você já possui uma casa/.test(sim), 'nenhuma trava de "uma casa por vez" sobrou');
  ok(sim.includes('casaEquipada: raridadeCasaValida(jogador.automation?.casaEquipada)'),
    'a equipada antiga, que só serve para pôr a escalação antiga na casa certa, passa pelo filtro');

  const fabCasa = trecho(sim, "'casa.fabricar': (p) => {", '\n  },');
  const fabBike = trecho(sim, "'bicicleta.fabricar': (p) => {", '\n  },');
  ok(fabCasa.includes("if (raridade === 'lendaria') anunciarDropLendario(p, 'casa');"), 'Casa Lendária avisa o chat');
  ok(fabBike.includes("if (raridade === 'lendaria') anunciarDropLendario(p, 'bicicleta');"), 'Bicicleta Lendária avisa o chat');
  ok((sim.match(/anunciarDropLendario\(p, '/g) ?? []).length === 2, 'o aviso sai só dos dois sorteios');
  const drop = trecho(sim, 'function anunciarDropLendario(p, tipo) {', '\n}\n');
  ok(drop.includes("canal: 'mundo'") && !drop.includes('CANAIS_CHAT') && !drop.includes('CANAL_GLOBAL'), 'drop Lendário: só no chat MUNDO, sem aviso na tela');
  ok(drop.includes('for (const idioma of IDIOMAS_CHAT)') && drop.includes("cargo: 'anuncio'"), 'uma linha por idioma, como anúncio (sem perfil clicável)');
  ok(ler('src/server/chat-db.mjs').includes("'dropLendario'"), 'o drop sobrevive ao histórico do chat');

  const bikeEquipar = trecho(sim, "'bicicleta.equipar': (p, m) => {", '\n  },');
  ok(bikeEquipar.includes('atualizarVelocidadeNoCentro(p)'), 'trocar de bicicleta com a praça aberta muda o passo lá');
  ok(/if \(pedida === antes\) return;[\s\S]*const espera = \(p\.automation\.bicicletaTrocadaEm \?\? 0\) \+ INTERVALO_TROCA_BICICLETA_MS - agora\(\);[\s\S]*equiparBicicleta\(p, pedida\)[\s\S]*if \(r\.bicicletaId === antes\) return;[\s\S]*p\.automation\.bicicletaTrocadaEm = agora\(\);[\s\S]*enviarEstado\(p\)/.test(bikeEquipar),
    'bicicleta.equipar: repetir a mesma não gasta nada, e trocar (ou guardar) espera o intervalo gravado na conta');
  ok(INTERVALO_TROCA_BICICLETA_MS === 5 * 60_000, 'o intervalo da bicicleta é de 5 minutos');
  ok(sim.includes('bicicletaTrocadaEm: instanteGravado(jogador.automation?.bicicletaTrocadaEm)'),
    'o instante da última troca volta do banco filtrado — sair e entrar de novo não zera a espera');
  ok(/trocaLiberaEm: p\.automation\.bicicletaTrocadaEm \?/.test(sim), 'o estado diz à tela quando a próxima troca fica livre');
}

// --------------------------------------------------------- o passo na praça

console.log('\n— o passo na praça');

/**
 * O que `tickSala` faz com o treinador que segura a tecla, tick a tick: fim do passo na TELA →
 * parado; livre para o próximo → passo no ritmo. `ritmo(t)` é o passo naquela hora (para trocar
 * de bicicleta no meio) e `proxTick(t)`, a hora do tick seguinte.
 */
function caminhar({ ritmo, duracao = 20_000, proxTick = (t) => t + TICK_MS }) {
  const e = { cx: 0, cy: 0, deCx: 0, deCy: 0, dir: 2, passoEm: 0, passoMs: MS_PASSO, andando: false };
  const passos = [];
  for (let t = 1_000; t <= 1_000 + duracao; t = proxTick(t)) {
    if (e.andando && paradoNaPraca(e, t)) {
      e.andando = false;
      e.deCx = e.cx;
      e.deCy = e.cy;
    }
    if (!podeDarPasso(e, t)) continue;
    const ms = ritmo(t);
    passoNoRitmo(e, e.cx + 1, e.cy, t, ms);
    passos.push({ t, em: e.passoEm, dur: e.passoMs, ms });
  }
  return passos;
}

/** O `setInterval` do Node: nunca adianta, e atrasa um ou dois ms por volta. */
function tickAtrasando() {
  let k = 0;
  return (t) => t + TICK_MS + [1, 2, 0, 1, 3, 1, 2, 4][k++ % 8];
}

/**
 * Um relógio que ora chega depois, ora 1–2 ms ANTES da conta redonda — o que o jogo local mediu:
 * sem a tolerância, a Lendária esperava um tick inteiro nesses passos (110 ms de média, não 100).
 */
function tickTremendo() {
  let k = 0;
  return (t) => t + TICK_MS + [-1, 1, 0, -2, 2, 0, 1, -1][k++ % 8];
}

function conferir(nome, passos, { msEsperado = null, semPausa = false } = {}) {
  let cortes = 0;
  let pausas = 0;
  let noPassado = 0;
  let atrasoMax = 0;
  for (let i = 0; i < passos.length; i++) {
    const p = passos[i];
    if (p.em < p.t) noPassado++;
    atrasoMax = Math.max(atrasoMax, p.em - p.t);
    if (!i) continue;
    const fimAnterior = passos[i - 1].em + passos[i - 1].dur;
    if (p.em < fimAnterior) cortes++;
    if (p.em > fimAnterior) pausas++;
  }
  ok(!cortes, `${nome}: nenhum passo corta o anterior na tela`, `${cortes} cortes`);
  ok(!noPassado, `${nome}: nenhum passo começa no passado do tick que o mandou`, `${noPassado}`);
  ok(atrasoMax <= FOLGA_RITMO_MS + TOLERANCIA_TICK_MS, `${nome}: a tela nunca fica mais que a folga atrás`, `${atrasoMax} ms`);
  if (semPausa) ok(!pausas, `${nome}: um passo emenda no outro, sem parada`, `${pausas} paradas`);
  if (msEsperado != null) {
    const media = (passos.at(-1).em - passos[1].em) / (passos.length - 2);
    ok(Math.abs(media - msEsperado) / msEsperado < 0.03, `${nome}: a velocidade média é a do ritmo`, `${media.toFixed(1)} ms por passo`);
  }
}

const ritmos = [
  { nome: 'a pé', ms: MS_PASSO },
  ...RARIDADES_BICICLETA.map((b) => ({ nome: `bicicleta ${b.id}`, ms: passoComBicicleta(MS_PASSO, fatorPassoDaRaridade(b.id)) })),
];
for (const r of ritmos) {
  for (const [relogio, proxTick] of [['tick exato', undefined], ['setInterval atrasando', tickAtrasando()], ['tick tremendo', tickTremendo()]]) {
    conferir(`${r.nome} (${r.ms} ms, ${relogio})`, caminhar({ ritmo: () => r.ms, proxTick }), {
      msEsperado: r.ms,
      semPausa: r.ms % TICK_MS !== 0,
    });
  }
}
for (const ms of [MS_PASSO, passoComBicicleta(MS_PASSO, fatorPassoDaRaridade('lendaria'))]) {
  const passos = caminhar({ ritmo: () => ms });
  ok(ms % TICK_MS === 0 && passos.every((p) => p.em === p.t && p.dur === ms), `${ms} ms cabe em ticks: o passo de sempre, do tick ao tick`);
}
{
  const vel = (id) => passoComBicicleta(MS_PASSO, fatorPassoDaRaridade(id));
  const ritmo = (t) => (t < 4_000 ? MS_PASSO : t < 8_000 ? vel('comum') : t < 12_000 ? vel('lendaria') : t < 16_000 ? vel('rara') : MS_PASSO);
  conferir('trocando de bicicleta no meio da caminhada', caminhar({ ritmo, proxTick: tickAtrasando() }));
  conferir('trocando de bicicleta, tick tremendo', caminhar({ ritmo, proxTick: tickTremendo() }));
}

console.log('\n— ninguém anda mais rápido que a bicicleta');
{
  // Um cliente adulterado controla só duas coisas: a tecla (solta e aperta quando quiser) e qual
  // bicicleta está equipada (troca a cada mensagem). Nenhuma combinação pode começar um passo
  // antes do fim do anterior — nem render mais passos por segundo que a Lendária.
  let semente = 12345;
  const aleatorio = () => (semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const ritmosPossiveis = [MS_PASSO, ...RARIDADES_BICICLETA.map((b) => passoComBicicleta(MS_PASSO, fatorPassoDaRaridade(b.id)))];
  const maisRapido = Math.min(...ritmosPossiveis);
  let violacoes = 0;
  let total = 0;
  let maxNoSegundo = 0;
  for (let rodada = 0; rodada < 200; rodada++) {
    const e = { cx: 0, cy: 0, deCx: 0, deCy: 0, dir: 2, passoEm: 0, passoMs: MS_PASSO, andando: false };
    let t = 1_000;
    let fimAnterior = -Infinity;
    const decisoes = [];
    for (let n = 0; n < 300; n++) {
      t += TICK_MS + Math.floor(aleatorio() * 7) - 2; // tick tremendo: 98 a 104 ms
      if (e.andando && paradoNaPraca(e, t)) {
        e.andando = false;
        e.deCx = e.cx;
        e.deCy = e.cy;
      }
      if (aleatorio() < 0.2) continue; // soltou a tecla neste tick
      if (!podeDarPasso(e, t)) continue;
      const ms = ritmosPossiveis[Math.floor(aleatorio() * ritmosPossiveis.length)]; // trocou de bicicleta
      passoNoRitmo(e, e.cx + 1, e.cy, t, ms);
      if (e.fimPasso - ms < fimAnterior) violacoes++;
      fimAnterior = e.fimPasso;
      decisoes.push(t);
      total++;
    }
    for (let i = 0, j = 0; i < decisoes.length; i++) {
      while (decisoes[i] - decisoes[j] >= 1_000) j++;
      maxNoSegundo = Math.max(maxNoSegundo, i - j + 1);
    }
  }
  ok(total > 10_000 && !violacoes, 'trocar de bicicleta e soltar a tecla à vontade nunca começa um passo antes do fim do anterior', `${violacoes} em ${total}`);
  ok(maxNoSegundo <= 1_000 / maisRapido + 1, `em qualquer segundo, no máximo ${1_000 / maisRapido + 1} passos — o teto da Lendária`, `${maxNoSegundo}`);
}

// ------------------------------------------------------------------ a tela

console.log('\n— a tela');
{
  const campo = ler('src/client/campo.mjs');
  ok(/e\.anterior = em > this\.agora && deCx === e\.cx && deCy === e\.cy/.test(campo) && campo.includes('e.anterior && agora < e.passoEm ? e.anterior : e'),
    'o cliente segura o passo em curso até o próximo começar');
  const app = ler('src/client/app.js');
  ok(!app.includes("t: 'casa.equipar'") && !app.includes('pedirEquiparCasa'), 'a tela não pede mais para equipar casa');
  const pedirBike = trecho(app, 'function pedirEquiparBicicleta(bici) {', '\n}\n');
  ok(/trocaLiberaEm[\s\S]*if \(falta > 0\) return toast\([\s\S]*confirmar\(/.test(pedirBike) && app.includes('const acao = () => pedirEquiparBicicleta(equipada ? null : bici);'),
    'a troca de bicicleta confirma sempre e, na espera, diz quanto falta');
  ok(!app.includes('tenhoCasaNaBolsa') && !app.includes("'casaMantida'") && !app.includes('recompensa.casaVirou'), 'a tela não tem mais trava nem texto de uma casa só');
  ok(app.includes("m.dropLendario ? ' drop-lendario' : ''") && ler('src/client/estilo.css').includes('.chat-msg.anuncio.drop-lendario .m-txt'),
    'o drop Lendário é dourado no chat');
  ok(app.includes("if (moedaEscolhida === 'gold') {\n      return avisarAnuncioEmCoins(") && !app.includes("alvo.tipo === 'pokemon' || alvo.tipo === 'diamante')"),
    'o aviso de "anunciando por Coins" vale para todo anúncio: pokémon, item e diamante');
}

console.log('\n— textos');
{
  const novas = [
    'casa.invalida', 'casa.fabRegra',
    'bicicleta.trocaEspera', 'bicicleta.trocarTitulo', 'bicicleta.trocarTexto', 'bicicleta.trocarSim',
    'bicicleta.guardarTitulo', 'bicicleta.guardarTexto', 'bicicleta.guardarSim',
    'chat.dropLendario', 'chat.dropLendarioCasa', 'chat.dropLendarioBicicleta',
  ];
  const velhas = [
    'casa.moroAqui', 'casa.soAMelhor', 'casa.jaPossuiAnuncie', 'casa.mantida', 'casa.upgrade', 'casa.fabIntro', 'recompensa.casaVirou',
    'casa.equipadaSelo', 'casa.equipar', 'casa.variasUmaEquipada', 'casa.jaEquipada', 'casa.trocaEspera', 'casa.trocarTitulo',
    'casa.equipadaToast', 'casa.suaAtual', 'casa.nenhumaEquipada', 'recompensa.casaSubEquipada', 'recompensa.casaSubEquipar',
  ];
  for (const l of ['pt', 'en', 'es']) {
    const faltam = novas.filter((k) => typeof _dicionarios[l]?.[k] !== 'string');
    ok(!faltam.length, `${l}: as ${novas.length} chaves existem`, faltam.join(', '));
    const frase = _dicionarios[l]['chat.dropLendario'] ?? '';
    ok(frase.includes('{nick}') && frase.includes('{item}'), `${l}: a frase do drop tem o nick e o item`);
    ok(!velhas.some((k) => k in _dicionarios[l]), `${l}: as frases de "uma casa por vez" e da casa equipada saíram`);
  }
  ok((_dicionarios.pt['chat.dropLendario'] ?? '').startsWith('[DROP Lendário] O jogador {nick} dropou uma {item} Lendária!'), 'pt: a frase pedida, palavra por palavra');
}

console.log(`\n${testes - falhas}/${testes} ok`);
if (falhas) {
  console.log(`${falhas} falha(s)`);
  process.exit(1);
}
