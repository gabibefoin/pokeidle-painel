// Sobe UM processo do jogo (gateway ou sim, pelo ROLE do ambiente) e mede a CPU dele numa janela.
//
//     ROLE=sim SHARD_COUNT=1 REDIS_URL=redis://localhost:6391 \
//       BENCH_ESPERA_S=45 BENCH_JANELA_S=60 BENCH_SAIDA=sim.cpuprofile node tools/bench-processo.mjs
//
// Espera `BENCH_ESPERA_S` (o boot e a chegada dos bots do `loadtest.mjs`), liga o profiler do
// próprio processo, mede `BENCH_JANELA_S` segundos e sai imprimindo uma linha `[bench]`: CPU em %
// de um núcleo (user e sys), RSS e, no sim, a média de jogadores e do tick na janela. O perfil vai
// para `BENCH_SAIDA` e abre no DevTools (aba Performance → Load profile).
//
// Não mexe em nada do jogo: é um `import` do `index.mjs` de sempre com um cronômetro em volta. Serve
// para comparar duas versões com a MESMA carga — rode o mesmo comando em cada árvore.
import inspector from 'node:inspector';
import { writeFileSync } from 'node:fs';

const espera = Number(process.env.BENCH_ESPERA_S ?? 45) * 1000;
const janela = Number(process.env.BENCH_JANELA_S ?? 60) * 1000;
const saida = process.env.BENCH_SAIDA ?? `bench-${process.env.ROLE ?? 'all'}-${process.pid}.cpuprofile`;

const sessao = new inspector.Session();
sessao.connect();
const post = (metodo, params = {}) =>
  new Promise((res, rej) => sessao.post(metodo, params, (err, r) => (err ? rej(err) : res(r))));

setTimeout(async () => {
  const sim = await import('../src/server/sim.mjs').catch(() => null);
  const ticks = [];
  const jogadores = [];
  const amostrar = setInterval(() => {
    if (!sim?.metricas) return;
    ticks.push(sim.metricas.tickMs);
    jogadores.push(sim.metricas.jogadores);
  }, 1000);
  await post('Profiler.enable');
  await post('Profiler.start');
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  setTimeout(async () => {
    clearInterval(amostrar);
    const { profile } = await post('Profiler.stop');
    const cpu = process.cpuUsage(cpu0);
    const ms = performance.now() - t0;
    writeFileSync(saida, JSON.stringify(profile));
    const pct = (us) => ((us / 1000 / ms) * 100).toFixed(1);
    const media = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
    console.log(
      `[bench] ${process.env.ROLE}: CPU ${pct(cpu.user + cpu.system)}% de um núcleo `
        + `(user ${pct(cpu.user)}% · sys ${pct(cpu.system)}%) em ${(ms / 1000).toFixed(0)} s · `
        + `rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`
        + (process.env.ROLE === 'sim'
          ? ` · jogadores ${media(jogadores).toFixed(0)} · tick médio ${media(ticks).toFixed(1)} ms`
          : ''),
    );
    process.exit(0);
  }, janela);
}, espera);

await import('../src/server/index.mjs');
