// Bancada da GUERRA DE GUILDS — quanto custa cada teto de tempo, com uma guerra de verdade.
//
// Roda `simularGuerra` sobre as linhas de uma guerra real (as mesmas duas leituras que o
// `guild-pvp.mjs` faz no banco) com cada teto pedido, algumas vezes cada — a simulação sorteia
// nascimentos e o tempo dos golpes —, e mede o que pesa na máquina:
//
//   · como a guerra acaba (wipe ou tempo) e em quanto tempo simulado;
//   · CPU gasta e tempo de parede;
//   · o PIOR bloco entre dois respiros (é o que o tick do sim sente, porque a guerra roda dentro
//     do mesmo processo que as hunts);
//   · o tamanho do replay: quadros, JSON e gzip (o gzip é a ordem de grandeza do que viaja
//     comprimido para quem clica em "assistir").
//
// As linhas vêm de um arquivo `{ reg, linhas }`. Para copiar as da guerra de um dia, na VPS, só
// leitura:
//
//   cd /opt/pokeidle/game && sudo -u pokeidle node --input-type=module -e "
//     const { registrosPvpDoDia, membrosParaGuerra } = await import('./src/server/guild-db.mjs');
//     const { pool } = await import('./src/server/db.mjs');
//     const reg = await registrosPvpDoDia('AAAA-MM-DD');
//     const linhas = await membrosParaGuerra(reg.map((g) => g.id));
//     await pool.end();
//     await new Promise((ok) => process.stdout.write(JSON.stringify({ reg, linhas }), ok));
//   " > guerra.json
//
//   node tools/bancada-guerra.mjs --linhas guerra.json [--limites 300000,600000] [--vezes 4]
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { simularGuerra, LIMITE_MS_DUELO, LIMITE_MS_GUERRA } from '../src/server/game/guild-pvp-sim.mjs';
import { guildsDasLinhas } from '../src/server/game/guild-pvp.mjs';

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : padrao;
};
const arquivo = arg('linhas', null);
if (!arquivo) {
  console.error('uso: node tools/bancada-guerra.mjs --linhas guerra.json [--limites 300000,600000] [--vezes 4]');
  process.exit(1);
}
const limites = String(arg('limites', `${LIMITE_MS_DUELO},${LIMITE_MS_GUERRA}`)).split(',').map(Number);
const vezes = Math.max(1, Number(arg('vezes', 4)));
const { reg, linhas } = JSON.parse(readFileSync(arquivo, 'utf8'));

const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function rodada(limiteMs) {
  // A lista é refeita a cada rodada: a simulação não devolve as guilds do jeito que recebeu.
  const guilds = guildsDasLinhas(reg, linhas).filter((g) => g.membros.some((m) => m.equipe.length));
  let ultimo = performance.now();
  let pior = 0;
  const blocos = [];
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  const r = await simularGuerra(guilds, {
    limiteMs,
    aoRespirar: () => {
      const agora = performance.now();
      const bloco = agora - ultimo;
      blocos.push(bloco);
      pior = Math.max(pior, bloco);
      return new Promise((ok) => setImmediate(() => {
        ultimo = performance.now();
        ok();
      }));
    },
  });
  const parede = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  const json = JSON.stringify(r.replay);
  const vivas = r.placar.filter((g) => g.membros.some((m) => m.sobreviveu)).length;
  return {
    guilds: guilds.length,
    lutadores: r.replay.atores.length / 2,
    motivo: r.motivo,
    duracaoS: r.duracaoMs / 1000,
    vivas,
    cpuMs: (cpu.user + cpu.system) / 1000,
    paredeMs: parede,
    piorBlocoMs: pior,
    blocoP95Ms: [...blocos].sort((a, b) => a - b)[Math.floor(blocos.length * 0.95)] ?? 0,
    quadros: r.replay.quadros.length,
    cheio: !!r.replay.cheio,
    jsonBytes: Buffer.byteLength(json),
    gzipBytes: gzipSync(json).length,
  };
}

console.log(`GUERRA DE GUILDS — ${reg.length} guilds registradas, ${linhas.length} linhas · ${vezes} rodada(s) por teto\n`);
for (const limiteMs of limites) {
  const rs = [];
  for (let i = 0; i < vezes; i++) rs.push(await rodada(limiteMs));
  const wipes = rs.filter((r) => r.motivo === 'wipe').length;
  console.log(`teto ${limiteMs / 60_000} min — ${rs[0].guilds} guilds, ${rs[0].lutadores} lutadores`);
  for (const r of rs) {
    console.log(
      `  ${r.motivo.padEnd(5)} ${r.duracaoS.toFixed(1).padStart(6)} s · ${String(r.vivas).padStart(2)} guild(s) de pé · ` +
      `CPU ${r.cpuMs.toFixed(0).padStart(5)} ms · parede ${r.paredeMs.toFixed(0).padStart(5)} ms · ` +
      `pior bloco ${r.piorBlocoMs.toFixed(1)} ms (p95 ${r.blocoP95Ms.toFixed(1)}) · ` +
      `${r.quadros} quadros${r.cheio ? ' (cheio)' : ''} · JSON ${kb(r.jsonBytes)} · gzip ${kb(r.gzipBytes)}`,
    );
  }
  console.log(
    `  → ${wipes}/${rs.length} terminaram em wipe · mediana: CPU ${mediana(rs.map((r) => r.cpuMs)).toFixed(0)} ms, ` +
    `pior bloco ${mediana(rs.map((r) => r.piorBlocoMs)).toFixed(1)} ms, JSON ${kb(mediana(rs.map((r) => r.jsonBytes)))}, ` +
    `gzip ${kb(mediana(rs.map((r) => r.gzipBytes)))}\n`,
  );
}
process.exit(0);
