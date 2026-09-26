// O pacote cru sim → gateway entrega ao navegador EXATAMENTE o que o caminho JSON entregava.
//
//     node tools/teste-saida-crua.mjs
//
// Para milhares de lotes sorteados (mensagens com todo caractere de controle, acento, emoji,
// U+2028, surrogate solto, objetos aninhados, estado com e sem guild/VIP/caixas, welcome), confere:
//
//   · cada frame recortado pelo gateway é igual a `JSON.stringify(mensagem)` — o que `codificar`
//     mandava antes —, na mesma ordem, e nenhum frame some ou sobra;
//   · o que o gateway guarda no socket (nível, VIP, fundador, guild, hello) sai igual ao que
//     `lerCargo` chegaria lendo mensagem por mensagem;
//   · o JSON antigo continua reconhecido como JSON, e um `para` com separador cai fora do cru.
//
// No fim, o tempo do caminho antigo (stringify do lote → parse → stringify de cada) contra o novo.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  MARCA_CRU, ehPacoteCru, paraCabeNoCru, metaDasMensagens, registroCru, pacoteCru, lerPacoteCru,
  criarSaidaEmLote, LIMITE_PACOTE,
} from '../src/server/saida-crua.mjs';
import { SERVIDOR, codificar } from '../src/server/protocol.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

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
const rnd = prng(424242);
const int = (n) => Math.floor(rnd() * n);

/** A regra de `lerCargo` do gateway, copiada: é o que o socket guardaria lendo mensagem por mensagem. */
function lerCargo(ws, msg) {
  const e = msg?.estado;
  if (!e) return;
  if (typeof e.level === 'number') ws.nivel = e.level;
  if (typeof e.loja?.vip === 'boolean') ws.vip = e.loja.vip;
  if (e.caixas) ws.fundador = e.caixas.tag ?? null;
  if ('guild' in e) ws.guildId = e.guild?.id ? Number(e.guild.id) : null;
}
/** O que o gateway novo faz com o meta. */
function aplicarMeta(ws, meta) {
  if (!meta) return;
  if ('l' in meta) ws.nivel = meta.l;
  if ('v' in meta) ws.vip = meta.v;
  if ('f' in meta) ws.fundador = meta.f;
  if ('g' in meta) ws.guildId = meta.g;
}

const CARACTERES = ['a', 'ã', 'ç', '"', '\\', '/', '\n', '\r', '\t', '\u0000', '\u0001', '\u0002', '\u001f', '\u2028',
  '\u2029', '😀', '\ud800', '{', '}', '[', ']', ':', ',', ' '];
function texto() {
  let s = '';
  for (let i = int(12); i > 0; i--) s += CARACTERES[int(CARACTERES.length)];
  return s;
}
function valor(profundidade = 0) {
  const r = rnd();
  if (profundidade > 3 || r < 0.35) return [int(1e6), -int(99), rnd() * 1000, texto(), true, false, null][int(7)];
  if (r < 0.6) return Array.from({ length: int(5) }, () => valor(profundidade + 1));
  const o = {};
  for (let i = int(6); i > 0; i--) o[texto() || 'k'] = valor(profundidade + 1);
  return o;
}
function mensagem() {
  const tipo = [SERVIDOR.ESTADO, SERVIDOR.CAMPO, SERVIDOR.BATALHA, SERVIDOR.WELCOME, 'evento'][int(5)];
  const m = { t: tipo, dados: valor() };
  if (tipo === SERVIDOR.ESTADO || tipo === SERVIDOR.WELCOME) {
    const e = {};
    if (rnd() < 0.5) e.level = int(300);
    if (rnd() < 0.4) e.loja = rnd() < 0.8 ? { vip: rnd() < 0.5 } : { vip: 'sim' };
    if (rnd() < 0.3) e.caixas = rnd() < 0.5 ? { tag: texto() } : {};
    if (rnd() < 0.4) e.guild = [null, { id: int(500) + 1 }, { id: 0 }, { id: String(int(90) + 1) }][int(4)];
    e.gold = int(1e9);
    m.estado = e;
  }
  return m;
}

console.log('PACOTE CRU sim → gateway\n========================');

// ------------------------------------------------------------------- fidelidade
{
  console.log('\nFidelidade');
  let lotes = 0;
  let frames = 0;
  let diferencas = 0;
  let cargoDiferente = 0;
  let welcomeDiferente = 0;
  let registrosLidos = 0;
  for (let rodada = 0; rodada < 3000; rodada++) {
    const jogadores = Array.from({ length: 1 + int(8) }, (_, i) => ({
      para: `nick_${rodada}_${i}`,
      msgs: Array.from({ length: 1 + int(4) }, mensagem),
    }));
    const pacote = pacoteCru(jogadores.map((j) => registroCru(j.para, j.msgs, SERVIDOR.WELCOME)));
    ok.silencioso = true;
    let k = 0;
    lerPacoteCru(pacote, (para, meta, recortados) => {
      const j = jogadores[k++];
      registrosLidos++;
      if (para !== j.para) diferencas++;
      if (recortados.length !== j.msgs.length) diferencas++;
      j.msgs.forEach((m, i) => {
        frames++;
        if (recortados[i] !== codificar(m)) diferencas++;
      });
      const esperado = { nivel: 'x', vip: 'x', fundador: 'x', guildId: 'x' };
      const obtido = { ...esperado };
      for (const m of j.msgs) lerCargo(esperado, m);
      aplicarMeta(obtido, meta);
      if (JSON.stringify(esperado) !== JSON.stringify(obtido)) cargoDiferente++;
      if (!!meta?.w !== j.msgs.some((m) => m.t === SERVIDOR.WELCOME)) welcomeDiferente++;
    });
    if (k !== jogadores.length) diferencas++;
    lotes++;
  }
  ok(diferencas === 0, `${frames} frames em ${lotes} pacotes: todo frame igual a codificar(mensagem), na ordem`, `${diferencas} diferenças`);
  ok(registrosLidos > 3000, `nenhum registro some (${registrosLidos} lidos)`);
  ok(cargoDiferente === 0, 'nível, VIP, fundador e guild no socket saem iguais aos de lerCargo mensagem a mensagem', `${cargoDiferente} diferentes`);
  ok(welcomeDiferente === 0, 'o aviso de welcome chega quando e só quando há welcome no registro');
}

// ------------------------------------------------------------------ fronteiras
{
  console.log('\nFronteiras');
  ok(!ehPacoteCru(codificar({ para: 'a', msg: { t: 'x' } })), 'JSON de sempre continua sendo lido como JSON');
  ok(ehPacoteCru(pacoteCru([registroCru('a', [{ t: 'x' }], SERVIDOR.WELCOME)])), 'o pacote cru é reconhecido pela marca');
  ok(!paraCabeNoCru('a\nb') && !paraCabeNoCru('a\u001fb') && !paraCabeNoCru('') && !paraCabeNoCru(null) && paraCabeNoCru('ash_ketchum'),
    'nick com separador (ou vazio) fica fora do cru');
  ok(metaDasMensagens([{ t: SERVIDOR.CAMPO, x: 1 }], SERVIDOR.WELCOME) === null, 'mensagem sem estado nem welcome não gera meta');
  const lidos = [];
  lerPacoteCru(`${MARCA_CRU}torto-sem-separador\n${registroCru('ok', [{ t: 'x' }], SERVIDOR.WELCOME)}`, (para) => lidos.push(para));
  ok(lidos.length === 1 && lidos[0] === 'ok', 'um registro torto é pulado sem derrubar o seguinte');
}

// ------------------------------------------------------------- lote com teto
{
  console.log('\nLote com teto (o welcome de 200 kB que derrubava o assinante)');
  const publicados = [];
  const agendados = [];
  const saida = criarSaidaEmLote({
    publicar: (canal, pacote) => publicados.push({ canal, pacote }),
    agendar: (fn) => agendados.push(fn),
    canalDe: (gw) => `gw:${gw}`,
    tipoWelcome: SERVIDOR.WELCOME,
  });
  const enviados = { a: [], b: [] };
  const grande = 'x'.repeat(300 * 1024);
  for (let i = 0; i < 4000; i++) {
    const gw = i % 3 === 0 ? 'b' : 'a';
    const msgs = i % 97 === 0
      ? [{ t: SERVIDOR.WELCOME, catalogo: grande, estado: { level: i } }] // maior que o teto sozinho
      : [{ t: SERVIDOR.BATALHA, ev: [i, texto()] }, { t: SERVIDOR.CAMPO, seq: i }];
    saida.enviar(gw, `jogador_${i}`, msgs);
    enviados[gw].push({ para: `jogador_${i}`, frames: msgs.map((m) => codificar(m)) });
  }
  for (const fn of agendados) fn();
  let acimaDoTeto = 0;
  const recebidos = { a: [], b: [] };
  for (const { canal, pacote } of publicados) {
    const gw = canal.slice(3);
    let registros = 0;
    lerPacoteCru(pacote, (para, meta, frames) => {
      registros++;
      recebidos[gw].push({ para, frames });
    });
    if (pacote.length > LIMITE_PACOTE && registros > 1) acimaDoTeto++;
  }
  ok(acimaDoTeto === 0, `nenhum dos ${publicados.length} pacotes passa de ${LIMITE_PACOTE / 1024} kB com mais de um registro dentro`);
  const maior = Math.max(...publicados.map((p) => p.pacote.length));
  ok(maior < 320 * 1024, `o maior pacote é o welcome sozinho (${(maior / 1024).toFixed(0)} kB)`);
  const iguais = ['a', 'b'].every((gw) => JSON.stringify(recebidos[gw]) === JSON.stringify(enviados[gw]));
  ok(iguais, 'cada gateway recebe todos os registros, na ordem exata em que foram enviados');
  ok(publicados.length < 400, `${publicados.length} publishes para 4.000 registros (antes: 4.000)`);
}

// ------------------------------------------------------------------ código
{
  console.log('\nNo código');
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
  const ler = (rel) => readFileSync(join(raiz, rel), 'utf8');
  const gateway = ler('src/server/gateway.mjs');
  const bus = ler('src/server/bus.mjs');
  const sim = ler('src/server/sim.mjs');
  ok(/assinarCru\(canalGateway\(gatewayId\)/.test(gateway), 'o gateway assina o canal dele no formato cru');
  ok(/assinar\(canalGateway\(gatewayId\), \(\{ para, msg, msgs, kick \}\)/.test(gateway), 'e continua entendendo o JSON (admin, kick, outro processo)');
  ok(/ehPacoteCru\(raw\)/.test(bus), 'o barramento desvia o pacote cru antes do JSON.parse');
  ok(/criarSaidaEmLote\(\{/.test(bus), 'e publica pela saída em lote com teto de tamanho');
  // O corpo do `enviar` cresceu (o corte do campo no Modo Economia mora lá dentro); o que
  // esta linha guarda é a CHAMADA — nada de `publicar` direto do sim.
  ok(/enviarAoGateway\(p\.gatewayId, p\.key, \[msg\]\)/.test(sim), 'o `enviar` do sim passa pela saída em lote');
  ok(/enviarAoGateway\(p\.gatewayId, p\.key, lote\)/.test(sim), 'e o lote do tick também');
}

// ------------------------------------------------------------------------ tempo
{
  console.log('\nTempo');
  const lote = Array.from({ length: 700 }, (_, i) => ({
    para: `jogador_${i}`,
    msgs: [
      { t: SERVIDOR.BATALHA, ev: Array.from({ length: 4 }, (_, k) => ({ k: 'dano', alvo: k, v: 123 + k, crit: false })) },
      { t: SERVIDOR.CAMPO, mobs: Array.from({ length: 6 }, (_, k) => ({ s: k, cx: 10 + k, cy: 20, hp: 55, dir: 2, ms: 520 })) },
      { t: SERVIDOR.ESTADO, estado: { gold: 123456, xp: 99999, level: 88, pkMud: [{ id: 1, xp: 5, hp: 40, stats: { atk: 50, def: 40 } }] } },
    ],
  }));
  const repeticoes = 60;
  let t = performance.now();
  let bytesVelho = 0;
  for (let r = 0; r < repeticoes; r++) {
    for (const j of lote) {
      const fio = JSON.stringify({ para: j.para, msgs: j.msgs }); // sim: um publish por jogador
      const { msgs } = JSON.parse(fio); // gateway: desmonta
      for (const m of msgs) bytesVelho += codificar(m).length; // e remonta
    }
  }
  const msVelho = performance.now() - t;
  t = performance.now();
  let bytesNovo = 0;
  for (let r = 0; r < repeticoes; r++) {
    const pacote = pacoteCru(lote.map((j) => registroCru(j.para, j.msgs, SERVIDOR.WELCOME))); // sim: um publish
    lerPacoteCru(pacote, (para, meta, frames) => { for (const f of frames) bytesNovo += f.length; }); // gateway: recorta
  }
  const msNovo = performance.now() - t;
  console.log(`  700 jogadores × 3 mensagens × ${repeticoes} ticks: caminho JSON ${msVelho.toFixed(0)} ms · cru ${msNovo.toFixed(0)} ms · ${(msVelho / msNovo).toFixed(1)}× (sem contar os ${700 * repeticoes} publishes que viram ${repeticoes})`);
  ok(bytesVelho === bytesNovo, 'os mesmos bytes chegam aos sockets pelos dois caminhos');
  ok(msNovo < msVelho, 'o caminho cru gasta menos CPU');
}

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
