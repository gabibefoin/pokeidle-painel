// A espera antes de reconectar — sem servidor, sem navegador.
//
//     node tools/teste-reconexao.mjs
//
// O que este teste protege:
//   · queda de rede de um jogador volta rápido (perto do 1,5 s de antes);
//   · reinício do servidor (1012) espalha a volta: 10 mil jogadores não entram no mesmo segundo;
//   · falha seguida dobra a espera até 30 s, sempre com sorteio;
//   · o cliente e o gateway usam mesmo os módulos (um nome trocado seria proteção que não roda).
import { readFileSync } from 'node:fs';
import { atrasoDeReconexao, REINICIO } from '../src/shared/reconexao.mjs';
import { CODIGO_REINICIO } from '../src/server/encerrar-gateway.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
let semente = 42;
const sorteio = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const faixa = (opts, n = 5000) => {
  let min = Infinity;
  let max = -Infinity;
  let soma = 0;
  for (let i = 0; i < n; i++) {
    const x = atrasoDeReconexao({ ...opts, aleatorio: sorteio });
    min = Math.min(min, x);
    max = Math.max(max, x);
    soma += x;
  }
  return { min, max, media: soma / n };
};

console.log('\nPrimeira tentativa');
{
  const rede = faixa({ tentativa: 1, codigo: 1006 });
  ok(rede.min >= 800 && rede.max <= 2500, 'queda de rede: entre 0,8 e 2,5 s', JSON.stringify(rede));
  ok(rede.media < 2000, 'e em média volta em menos de 2 s', `${Math.round(rede.media)} ms`);
  const reinicio = faixa({ tentativa: 1, codigo: REINICIO });
  ok(reinicio.min >= 1000 && reinicio.max <= 15000, 'servidor reiniciando (1012): entre 1 e 15 s', JSON.stringify(reinicio));
  ok(REINICIO === CODIGO_REINICIO && REINICIO === 1012, 'cliente e gateway falam o mesmo código (1012)');
}

console.log('\nRajada de um deploy');
{
  const N = 10_000;
  const porSegundo = new Map();
  for (let i = 0; i < N; i++) {
    const s = Math.floor(atrasoDeReconexao({ tentativa: 1, codigo: REINICIO, aleatorio: sorteio }) / 1000);
    porSegundo.set(s, (porSegundo.get(s) ?? 0) + 1);
  }
  const pico = Math.max(...porSegundo.values());
  console.log(`    (10.000 jogadores: pico de ${pico} logins num segundo; antes, 10.000 no mesmo segundo)`);
  ok(pico <= 850, '10 mil jogadores de um gateway reiniciado: no máximo ~850 logins por segundo', `${pico}`);
}

console.log('\nFalhas seguidas');
{
  const t2 = faixa({ tentativa: 2 });
  const t3 = faixa({ tentativa: 3 });
  const t5 = faixa({ tentativa: 5 });
  const t20 = faixa({ tentativa: 20 });
  ok(t2.min >= 1000 && t2.max <= 2000, '2ª tentativa: 1–2 s', JSON.stringify(t2));
  ok(t3.min >= 2000 && t3.max <= 4000, '3ª: 2–4 s (dobrou)', JSON.stringify(t3));
  ok(t5.min >= 8000 && t5.max <= 16000, '5ª: 8–16 s', JSON.stringify(t5));
  ok(t20.max <= 30000 && t20.min >= 15000, 'nunca passa de 30 s, e segue sorteada', JSON.stringify(t20));
  const lixo = [0, -3, NaN, '2', undefined].map((tentativa) => atrasoDeReconexao({ tentativa, aleatorio: () => 0.5 }));
  ok(lixo.every((x) => Number.isFinite(x) && x > 0), 'tentativa torta vira um atraso válido', lixo.join(' '));
}

console.log('\nLigado de verdade');
{
  const app = readFileSync(new URL('../src/client/app.js', import.meta.url), 'utf8');
  ok(/import \{ atrasoDeReconexao \} from '\.\.\/shared\/reconexao\.mjs';/.test(app), 'o cliente importa o módulo');
  ok(/agendarReconexao\(atrasoDeReconexao\(\{ tentativa: estado\.tentativasReconexao, codigo: ev\.code \}\)\)/.test(app),
    'o onclose usa o código do fechamento e a contagem de tentativas');
  ok(/if \(m\.t === 'welcome'\) \{\s*estado\.tentativasReconexao = 0;/.test(app), 'o welcome zera a contagem');
  ok(!/agendarReconexao\(1500\)/.test(app), 'não sobrou o 1,5 s fixo');
  const gw = readFileSync(new URL('../src/server/gateway.mjs', import.meta.url), 'utf8');
  ok(/fecharParaReinicio\(wss\.clients\)/.test(gw) && /process\.once\('SIGTERM'/.test(gw), 'o gateway fecha com 1012 no SIGTERM');
}

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
