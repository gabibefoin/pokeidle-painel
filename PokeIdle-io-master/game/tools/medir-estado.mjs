// Quanto um jogador CAÇANDO baixa pelo socket, medido no fio.
//
//   node tools/medir-estado.mjs [nick] [segundos] [pokemonsNoDepot]
//
// `medir-banda.mjs` mede a primeira carga (assets, HTTP, cache) com um Chrome de verdade.
// Esta aqui mede a outra metade, que é a que cresce com o número de jogadores e não tem CDN
// que resolva: **o estado do jogo, por jogador, por segundo**.
//
// Existe por causa de uma conta que não fechava. A documentação dizia "~15 MB/hora por
// socket"; a medição em produção deu 335 MB/hora, e 97% disso era um pacote só — o `estado`,
// que reenviava a coleção inteira de pokémon a cada golpe recebido. O número da documentação
// não estava errado quando foi escrito: ele foi medido com um treinador novo, de 1 pokémon.
// A conta explodiu junto com o Depot dos jogadores, e ninguém remediu.
//
// Por isso o TAMANHO DO DEPOT é um parâmetro aqui, e não um detalhe do ambiente: é ele que
// separa "custa 2 MB/hora" de "custa 335 MB/hora". Meça sempre com um depot parecido com o do
// jogador real (a média em produção passa de 200) — medir com 1 pokémon é como testar um
// caminhão vazio.
//
// O que se conta é `socket.bytesRead`: bytes de VERDADE no fio, já comprimidos pelo
// permessage-deflate, que é exatamente o que a hospedagem cobra. O tamanho do JSON depois de
// descomprimido seria um número bonito e errado.
import { WebSocket } from 'ws';
import { execFileSync } from 'node:child_process';
import { helloCom, sessaoPara } from './auth-teste.mjs';

// Import tolerante: a ferramenta precisa rodar TAMBÉM contra uma versão do servidor anterior
// ao estado em delta — é assim que se compara o antes com o depois na mesma máquina, na mesma
// hunt e com o mesmo depot. Sem o módulo, o estado já chega completo e mesclar é a identidade.
let mesclar = (x) => x;
try {
  const { criarMescladorDeEstado } = await import('../src/shared/estado-delta.mjs');
  mesclar = criarMescladorDeEstado();
} catch {}

const URL = process.env.WS_URL ?? 'ws://localhost:8080';
const [nick = `bw${Date.now() % 100000}`, segundos = 60, depot = 200] = process.argv.slice(2);
const SEG = Number(segundos);
const DEPOT = Number(depot);
const HUNT = process.env.HUNT ?? 'pidgey';
const PG = process.env.PG_CONTAINER ?? 'game-postgres-1';

const psql = (sql) =>
  execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'poke', '-d', 'pokeidle', '-t', '-A', '-c', sql])
    .toString()
    .trim();

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const kb = (n) => (n / 1024).toFixed(1);

// ------------------------------------------------------------------ o jogador
const sessao = await sessaoPara(nick);
let playerId = psql(`SELECT id FROM players WHERE lower(nick) = lower('${sessao.nick}')`);
if (!playerId) {
  // A linha em `players` (e o starter) só nascem no primeiro `hello`. Um socket cru resolve —
  // sem isto a ferramenta exigiria rodar o smoke antes, e uma ferramenta de medição que só
  // funciona depois de outra é uma ferramenta que ninguém roda.
  console.log(`criando o treinador ${sessao.nick}…`);
  const w0 = new WebSocket(URL);
  await new Promise((ok) => w0.once('open', ok));
  w0.send(JSON.stringify(helloCom(sessao)));
  await new Promise((ok) => {
    const fim = setTimeout(ok, 15000);
    w0.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t !== 'welcome') return;
      if (m.starters?.length) {
        w0.send(JSON.stringify({ t: 'visual.set', genero: 'male', visual: {} }));
        w0.send(JSON.stringify({ t: 'starter.pick', speciesId: m.starters[0].speciesId }));
        setTimeout(() => { clearTimeout(fim); ok(); }, 3000);
      } else { clearTimeout(fim); ok(); }
    });
  });
  w0.close();
  await dormir(1500);
  playerId = psql(`SELECT id FROM players WHERE lower(nick) = lower('${sessao.nick}')`);
}
if (!playerId) throw new Error(`não consegui criar o treinador ${sessao.nick}`);

const jaTem = Number(psql(`SELECT count(*) FROM player_pokemon WHERE player_id = ${playerId}`));
if (jaTem < DEPOT) {
  const faltam = DEPOT - jaTem;
  psql(`INSERT INTO player_pokemon (player_id, species_id, level, xp, quality, ivs, hp, shiny, slot)
        SELECT ${playerId}, 1 + (g % 150), 5 + (g % 90), 0, 1.2,
               '{"hp":16,"atk":16,"def":16,"spAtk":16,"spDef":16,"speed":16}'::jsonb, 50, false, NULL
        FROM generate_series(1, ${faltam}) g`);
  console.log(`depot preenchido: +${faltam} pokémon (tinha ${jaTem})`);
}
const total = Number(psql(`SELECT count(*) FROM player_pokemon WHERE player_id = ${playerId}`));

// ------------------------------------------------------------------- a medida
const porTipo = new Map();
const qtdTipo = new Map();
let comprimido = false;

const ws = new WebSocket(URL, { perMessageDeflate: true });
let bytes0 = 0;
let t0 = 0;

ws.on('upgrade', (res) => {
  comprimido = /permessage-deflate/.test(res.headers['sec-websocket-extensions'] ?? '');
});

ws.on('open', () => ws.send(JSON.stringify(helloCom(sessao))));

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') {
    mesclar(m.estado);
    // Só começa a contar DEPOIS da carga inicial: o welcome é uma vez por sessão e mediria a
    // entrada, não o regime permanente, que é o que multiplica por hora e por jogador.
    ws.send(JSON.stringify({ t: 'hunt.select', slug: HUNT }));
    setTimeout(() => {
      bytes0 = ws._socket.bytesRead;
      t0 = Date.now();
    }, 1500);
    return;
  }
  if (m.t === 'estado') mesclar(m.estado);
  if (!t0) return;
  porTipo.set(m.t, (porTipo.get(m.t) ?? 0) + raw.length);
  qtdTipo.set(m.t, (qtdTipo.get(m.t) ?? 0) + 1);
});

ws.on('error', (err) => {
  console.error('socket:', err.message);
  process.exit(1);
});

await dormir((SEG + 3) * 1000);

const fio = ws._socket.bytesRead - bytes0;
const dur = (Date.now() - t0) / 1000;
ws.close();

const descomprimido = [...porTipo.values()].reduce((s, n) => s + n, 0);

console.log(`\n${sessao.nick} · ${total} pokémon · hunt ${HUNT} · ${dur.toFixed(0)}s`);
console.log(`compressão do socket: ${comprimido ? 'LIGADA (permessage-deflate)' : 'DESLIGADA'}`);
console.log('─'.repeat(72));
console.log('tipo'.padEnd(14), 'qtd'.padStart(6), 'msg/s'.padStart(7), 'bytes(JSON)'.padStart(13), 'B/msg'.padStart(9));
for (const [t, b] of [...porTipo.entries()].sort((a, c) => c[1] - a[1])) {
  const n = qtdTipo.get(t);
  console.log(
    t.padEnd(14), String(n).padStart(6), (n / dur).toFixed(2).padStart(7),
    String(b).padStart(13), String(Math.round(b / n)).padStart(9),
  );
}
console.log('─'.repeat(72));
console.log(`JSON somado ....... ${kb(descomprimido)} kB  (${kb(descomprimido / dur)} kB/s)`);
console.log(`NO FIO ............ ${kb(fio)} kB  (${kb(fio / dur)} kB/s)`);
console.log(`                    ${((fio / dur) * 3600 / 1048576).toFixed(1)} MB/hora por jogador`);
if (descomprimido > 0) {
  console.log(`ganho da compressão: ${(100 - (100 * fio) / descomprimido).toFixed(1)}%`);
}
process.exit(0);
