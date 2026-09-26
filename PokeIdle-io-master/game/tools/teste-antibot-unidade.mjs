// Limites por conta e sinais de automação — sem servidor, sem banco.
//
//     node tools/teste-antibot-unidade.mjs
//
// O que este teste protege:
//   · os picos REAIS de um jogador (medidos em produção, 14 dias até 15/09/2026) passam sem
//     nenhuma recusa — limite que pega jogador de verdade é bug, não segurança;
//   · o ritmo de bot (rajada, varredura contínua, reconexão em laço) esbarra;
//   · todo tipo com categoria existe mesmo em `comandos` do sim (um nome errado seria um limite
//     que nunca vale);
//   · os sinais de automação não disparam com jogador humano rápido e disparam com ritmo de
//     máquina — e nunca mais de uma vez por hora;
//   · o custo por mensagem.
import { readFileSync } from 'node:fs';
import { criarLimites, REGRAS } from '../src/server/limites-ws.mjs';
import {
  registrarCompraMercado, registrarArremessoManual, BOLA_POR_HORA,
} from '../src/server/telemetria-bot.mjs';
import { planoDaCompra, JANELA_SORTEIO_MS, ESPALHAR_SORTEIO_MS } from '../src/server/sorteio-mercado.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

/** Quantas de `n` ações espalhadas por igual em `janelaMs` o limite recusa. */
function recusasEmRitmo(categoria, n, janelaMs) {
  let t = 1_000_000;
  const lim = criarLimites({ agora: () => t });
  let recusas = 0;
  for (let i = 0; i < n; i++) {
    t = 1_000_000 + Math.floor((i * janelaMs) / Math.max(1, n - 1));
    if (!lim.permitir('jogador', categoria, t)) recusas++;
  }
  return recusas;
}
/** Tudo de uma vez, no mesmo milissegundo. */
function recusasNaRajada(categoria, n) {
  const lim = criarLimites({ agora: () => 5 });
  let recusas = 0;
  for (let i = 0; i < n; i++) if (!lim.permitir('jogador', categoria, 5)) recusas++;
  return recusas;
}

console.log('ANTI-BOT — UNIDADE\n==================');

console.log('\nPicos reais de um jogador passam inteiros');
const picos = [
  ['mercadoCompra', 19, 10_000, 'compra no mercado: 19 em 10 s'],
  ['mercadoCompra', 32, 60_000, 'compra no mercado: 32 em 1 min'],
  ['mercadoAnuncio', 9, 10_000, 'anúncio/cancelamento: 9 em 10 s'],
  ['mercadoAnuncio', 13, 60_000, 'anúncio/cancelamento: 13 em 1 min'],
  ['lojaCompra', 82, 10_000, 'loja NPC: 82 em 10 s'],
  ['lojaCompra', 243, 60_000, 'loja NPC: 243 em 1 min'],
  ['lojaVenda', 40, 10_000, 'venda ao NPC: 40 em 10 s'],
  ['lojaVenda', 105, 60_000, 'venda ao NPC: 105 em 1 min'],
  ['mercadoLeitura', 20, 5_000, 'leitura do mercado: 20 em 5 s (filtros e páginas)'],
  ['geral', 15, 0, 'rajada geral de 15 mensagens'],
  ['geral', 200, 10_000, 'geral: 20/s por 10 s'],
];
for (const [cat, n, janela, nome] of picos) {
  const r = janela ? recusasEmRitmo(cat, n, janela) : recusasNaRajada(cat, n);
  ok(r === 0, nome, `${r} recusa(s)`);
}
// Os mesmos picos TODOS AO MESMO TEMPO (categorias independentes).
{
  let t = 0;
  const lim = criarLimites({ agora: () => t });
  let recusas = 0;
  for (let i = 0; i < 60; i++) {
    t = i * 1000;
    for (const cat of ['mercadoCompra', 'lojaCompra', 'lojaVenda']) if (!lim.permitir('j', cat, t)) recusas++;
    // anúncio no ritmo do pico real (13 por minuto), junto com o resto
    if (i % 5 === 0 && !lim.permitir('j', 'mercadoAnuncio', t)) recusas++;
  }
  ok(recusas === 0, 'compra, loja e venda a 1/s com anúncio a cada 5 s, por 1 min, sem recusa', `${recusas}`);
}

console.log('\nRitmo de bot esbarra');
ok(recusasNaRajada('mercadoCompra', 100) === 75, 'rajada de 100 compras: passam só 25');
ok(recusasEmRitmo('mercadoLeitura', 600, 60_000) > 300, 'varredura de 10 leituras/s por 1 min: a maior parte recusada', `${recusasEmRitmo('mercadoLeitura', 600, 60_000)}`);
ok(recusasEmRitmo('mercadoCompra', 300, 60_000) > 200, 'comprar 5/s por 1 min: recusado', `${recusasEmRitmo('mercadoCompra', 300, 60_000)}`);
{
  let t = 0;
  const lim = criarLimites({ agora: () => t });
  for (let i = 0; i < 25; i++) lim.permitir('conta:7', 'hello', t);
  // "reconecta" 10 vezes em 10 s: o balde é da conta, não do socket.
  let recusas = 0;
  for (let i = 0; i < 10; i++) { t += 1000; if (!lim.permitir('conta:7', 'hello', t)) recusas++; }
  ok(recusas >= 6, 'hello em laço: a reconexão não devolve o balde', `${recusas} de 10 recusados`);
}

console.log('\nRelato e faxina');
{
  let t = 0;
  const lim = criarLimites({ agora: () => t });
  for (let i = 0; i < 40; i++) lim.permitir('j', 'mercadoCompra', t);
  const r1 = lim.relatoDeRecusas('j', t + 60_001);
  const r2 = lim.relatoDeRecusas('j', t + 60_002);
  ok(/mercadoCompra=15/.test(r1 ?? '') && r2 === null, 'relato conta as recusas e cala por 1 min', `${r1} / ${r2}`);
  lim.faxina(t + 11 * 60_000);
  ok(lim.tamanho() === 0, 'conta parada há 10 min sai da memória');
}

console.log('\nTodo tipo com categoria existe em `comandos`');
{
  const sim = readFileSync(new URL('../src/server/sim.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const ini = sim.indexOf('const comandos = {');
  const bloco = sim.slice(ini, sim.indexOf('\n};\n', ini));
  const chaves = new Set([...bloco.matchAll(/^  '([a-zA-Z0-9_.:-]+)'\s*[:(]/gm)].map((m) => m[1]));
  const lim = criarLimites();
  const src = readFileSync(new URL('../src/server/limites-ws.mjs', import.meta.url), 'utf8');
  const tipos = [...src.matchAll(/'([a-z]+(?:\.[a-zA-Z]+)+)'/g)].map((m) => m[1]).filter((t) => lim.categoriaDe(t));
  const faltando = tipos.filter((t) => !chaves.has(t));
  ok(tipos.length > 30 && !faltando.length, `${tipos.length} tipos com categoria, todos existem no sim`, faltando.join(', '));
  ok(Object.keys(REGRAS).every((c) => REGRAS[c].capacidade >= 1 && REGRAS[c].porSegundo > 0), 'toda regra tem capacidade e reposição');
}

console.log('\nModo Economia: liga/desliga não vira bomba de snapshot');
{
  // Desligar o modo faz o sim remontar e mandar a cena inteira. Só com o limite geral (20/s),
  // alternar em laço forçaria dez `campo.init` por segundo — na praça, com todo mundo dentro.
  const lim = criarLimites();
  ok(lim.categoriaDe('cliente.economia') === 'economia', '`cliente.economia` tem balde próprio');
  ok(recusasNaRajada('economia', 10) === 0, 'dez trocas seguidas passam (quem mexe no interruptor)');
  ok(recusasNaRajada('economia', 11) === 1, 'a 11ª da rajada é recusada');
  const laco = recusasEmRitmo('economia', 200, 10_000);
  ok(laco >= 180, 'o laço de 20 trocas/s por 10 s é cortado', `${laco} de 200 recusadas`);
  ok(recusasEmRitmo('economia', 20, 60_000) === 0, 'e uma troca a cada 3 s nunca é recusada');
}

console.log('\nSinal de compra colada na liberação');
{
  const p = {};
  const base = 10_000_000;
  ok(registrarCompraMercado(p, { compravelEm: base, t: base + 40 }) === null, '1ª compra rápida: nada');
  ok(registrarCompraMercado(p, { compravelEm: base + 5000, t: base + 5030 }) === null, '2ª: nada');
  const s = registrarCompraMercado(p, { compravelEm: base + 9000, t: base + 9020 });
  ok(s?.acao === 'mercado_snipe' && /3 pedidos/.test(s.detalhe), '3ª na mesma hora: sinal', JSON.stringify(s));
  ok(registrarCompraMercado(p, { compravelEm: base + 12000, t: base + 12010 }) === null, '4ª na mesma hora: não repete o sinal');
  const humano = {};
  let sinais = 0;
  for (let i = 0; i < 50; i++) {
    const libera = base + i * 60_000;
    if (registrarCompraMercado(humano, { compravelEm: libera, t: libera + 2000 + (i % 7) * 900 })) sinais++;
  }
  ok(sinais === 0, 'comprador que compra 2 s ou mais depois de liberar nunca é sinalizado');
  ok(registrarCompraMercado({}, { compravelEm: base, t: base - 10 }) === null, 'compra antes da liberação (anúncio editado) não conta');
}

console.log('\nSinal de arremesso manual com ritmo de máquina');
{
  // Humano: intervalos de 1,2 a 5 s e reação de 250 a 1200 ms, por 3 horas.
  const humano = {};
  let t = 50_000_000;
  let sinais = 0;
  let semente = 42;
  const aleatorio = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 4000; i++) {
    t += 1200 + Math.floor(aleatorio() * 3800);
    if (registrarArremessoManual(humano, { t, mortoEm: t - (250 + Math.floor(aleatorio() * 950)) })) sinais++;
  }
  ok(sinais === 0, 'humano rápido por horas: nenhum sinal');

  const bot = {};
  t = 90_000_000;
  let sinal = null;
  for (let i = 0; i < 80 && !sinal; i++) {
    t += 1200 + (i % 3) * 10;
    sinal = registrarArremessoManual(bot, { t, mortoEm: t - (40 + (i % 5) * 10) });
  }
  ok(sinal?.acao === 'bola_ritmo', 'intervalo de 1,2 s cravado e reação de 40–80 ms: sinal', JSON.stringify(sinal));

  const incansavel = {};
  t = 200_000_000;
  let volume = null;
  for (let i = 0; i < BOLA_POR_HORA * 3 && !volume; i++) {
    t += 2250 + (i % 11) * 3; // ~1.590 por hora, reação lenta (não é o sinal de ritmo)
    const r = registrarArremessoManual(incansavel, { t, mortoEm: t - 900 - (i % 13) * 60 });
    if (r?.acao === 'bola_volume') volume = r;
  }
  ok(volume?.acao === 'bola_volume', `${BOLA_POR_HORA}+ arremessos manuais por hora, duas horas seguidas: sinal`, JSON.stringify(volume));
}

console.log('\nSorteio da liberação do Mercado');
{
  const libera = 1_000_000;
  const tentaEm = (chegada, sorteio = 0.5) => chegada + planoDaCompra(libera, chegada, () => sorteio).esperaMs;
  ok(planoDaCompra(null, libera).tipo === 'agora', 'anúncio sem retenção: compra na hora');
  ok(planoDaCompra(libera, libera - 1).tipo === 'retido', 'antes de liberar: quem responde é a retenção, como sempre');
  ok(planoDaCompra(libera, libera + 5).tipo === 'sorteio' && tentaEm(libera + 5, 0) === libera + JANELA_SORTEIO_MS,
    'pedido no 5º ms com sorteio 0: tenta aos 3,0 s', `${tentaEm(libera + 5, 0) - libera}`);
  ok(tentaEm(libera + 2999, 0.999) === libera + 3999, 'pedido aos 2,999 s com sorteio 0,999: tenta aos 3,999 s', `${tentaEm(libera + 2999, 0.999) - libera}`);
  const instantes = [1, 400, 1500, 2999].map((d) => tentaEm(libera + d, 0.37));
  ok(instantes.every((x) => x === instantes[0]),
    'mesmo sorteio, chegada diferente: o MESMO instante de tentativa — chegar primeiro não conta', instantes.map((x) => x - libera).join(' '));
  const espera = planoDaCompra(libera, libera + 3500);
  ok(espera.tipo === 'espera' && tentaEm(libera + 3500) > libera + JANELA_SORTEIO_MS + ESPALHAR_SORTEIO_MS,
    'pedido entre 3 e 4 s: tenta depois do último instante sorteado', JSON.stringify(espera));
  ok(planoDaCompra(libera, libera + 4000).tipo === 'agora', 'depois de 4 s: compra na hora, como antes');

  // 20.000 liberações disputadas por 2 bots (10–40 ms), 3 pessoas (0,6–2,9 s) e um atrasado
  // (3–4 s). Antes do sorteio, levava sempre quem chegava primeiro: os bots, 100% das vezes.
  let semente = 7;
  const aleatorio = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const RODADAS = 20_000;
  let pessoas = 0;
  let atrasado = 0;
  for (let r = 0; r < RODADAS; r++) {
    const chegadas = [
      10 + aleatorio() * 30, 10 + aleatorio() * 30,
      600 + aleatorio() * 2300, 600 + aleatorio() * 2300, 600 + aleatorio() * 2300,
      3000 + aleatorio() * 999,
    ];
    const tentativas = chegadas.map((d) => libera + d + planoDaCompra(libera, libera + d, aleatorio).esperaMs);
    const vencedor = tentativas.indexOf(Math.min(...tentativas));
    if (vencedor >= 2 && vencedor <= 4) pessoas++;
    if (vencedor === 5) atrasado++;
  }
  const fatia = pessoas / RODADAS;
  console.log(`    (pessoas levam ${(fatia * 100).toFixed(1)}% das liberações; antes, 0%)`);
  ok(fatia > 0.57 && fatia < 0.63, '3 pessoas contra 2 bots: as pessoas levam ~3/5 — a chance é por pedido, não por velocidade', `${(fatia * 100).toFixed(1)}%`);
  ok(atrasado === 0, 'quem chega depois dos 3 s nunca passa na frente de quem entrou no sorteio', `${atrasado}`);

  // A volta do sorteio entra no comando por um TERCEIRO argumento. Se o despacho do socket um dia
  // passar mais do que `(p, msg)`, o cliente poderia pular a fila — este teste pega.
  const fonteSim = readFileSync(new URL('../src/server/sim.mjs', import.meta.url), 'utf8');
  ok(/const fn = comandos\[msg\.t\];\s*if \(fn\) fn\(p, msg\);/.test(fonteSim),
    'o socket chama o comando só com (p, msg): a volta do sorteio não é alcançável pelo cliente');
}

console.log('\nCusto');
{
  const lim = criarLimites();
  const contas = Array.from({ length: 2000 }, (_, i) => `jogador${i}`);
  const n = 2_000_000;
  const ini = process.hrtime.bigint();
  let t = Date.now();
  for (let i = 0; i < n; i++) {
    if ((i & 1023) === 0) t += 1;
    lim.permitir(contas[i % 2000], i & 1 ? 'geral' : 'mercadoLeitura', t);
  }
  const ns = Number(process.hrtime.bigint() - ini) / n;
  console.log(`    (${ns.toFixed(0)} ns por verificação, 2.000 contas em memória)`);
  ok(ns < 2000, 'verificação de limite abaixo de 2 µs por mensagem', `${ns.toFixed(0)} ns`);
}

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
