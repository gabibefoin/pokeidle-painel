import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// .env minimalista — não vale puxar uma dependência só para isto.
//
// O valor vai para `process.env` TAMBÉM, e não só para o objeto local. Nem tudo que sai
// deste arquivo passa por `config`: a ponte com a blockchain (`chain.mjs`), a seed dos
// depósitos e a chave da carteira leem direto do ambiente, porque são segredos que não
// devem ficar pendurados num objeto exportado que qualquer módulo importa.
//
// Sem isto, `CHAIN_REDE=solana` no arquivo era silenciosamente ignorado e o jogo subia na
// rede SIMULADA achando que estava na devnet — o pior tipo de erro de configuração, porque
// tudo "funciona" e nada acontece de verdade.
const env = { ...process.env };
const arquivoEnv = resolve(raiz, '.env');
if (existsSync(arquivoEnv)) {
  for (const linha of readFileSync(arquivoEnv, 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (m && env[m[1]] === undefined) {
      const valor = m[2].replace(/^["']|["']$/g, '');
      env[m[1]] = valor;
      // O ambiente de verdade só é tocado onde ele ainda não tem nada: variável exportada
      // no shell continua ganhando do arquivo, que é o esperado em produção.
      if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
    }
  }
}

const num = (v, d) => (v === undefined ? d : Number(v));

export const config = {
  raiz,
  porta: num(env.PORT, 8080),
  // all = gateway + simulação no mesmo processo (dev). Em produção sobem separados.
  role: env.ROLE ?? 'all',
  shardId: num(env.SHARD_ID, 0),
  shardCount: num(env.SHARD_COUNT, 1),
  // Shard dono das Arenas PvP ao vivo. Todas rodam nesse processo só — quem entra vindo de
  // outro shard é migrado para lá (ver o cabeçalho de `game/pvp.mjs`). Não precisa mudar isto
  // para o cluster funcionar; só existe caso um dia valha a pena escolher outro shard fixo.
  arenaShardId: num(env.ARENA_SHARD_ID, 0),

  databaseUrl: env.DATABASE_URL ?? 'postgres://poke:poke@localhost:5433/pokeidle',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6380',
  // Conexões do Postgres POR PROCESSO. 25 é o que o processo único precisava no pico de F5 (ver
  // `db.mjs`); com 10 sims e 6 gateways na mesma máquina, 25 em cada passaria do `max_connections`
  // do banco — os units do systemd baixam (ver `infra/FASES-ESCALA.md`).
  pgPoolMax: Math.max(1, num(env.PG_POOL_MAX, 25) || 25),

  tickMs: num(env.TICK_MS, 250),
  flushMs: num(env.FLUSH_MS, 5000),

  // o espelho de assets do sprite-lab: creatures, spawns, itens, fórmulas, sprites e mapas
  assetsDir: resolve(raiz, env.ASSETS_DIR ?? '../public/data'),

  // identidade deste processo, usada para rotear respostas de volta ao gateway certo
  instanceId: `${env.ROLE ?? 'all'}-${env.SHARD_ID ?? 0}-${process.pid}`,

  // ---------------------------------------------------------------- ORBs
  //
  // O endereço PÚBLICO da carteira do projeto — para onde vão os depósitos e de onde saem os
  // saques. Fica vazio em dev de propósito: a tela avisa "depósito não configurado" em vez de
  // mostrar um endereço inventado, que é o tipo de erro que custa o dinheiro de alguém.
  //
  // A CHAVE PRIVADA não mora aqui. Ela é lida direto do ambiente por `chain.mjs`, que é a
  // única parte do sistema que precisa dela.
  carteiraProjeto: env.CARTEIRA_PROJETO ?? '',
  carteiraRede: env.CARTEIRA_REDE ?? 'solana',
  // Ligar o worker de saque neste processo. Só UM processo do cluster deve ligá-lo — dois
  // workers assinando o mesmo saque é a forma mais fácil de pagar duas vezes.
  orbsWorker: env.ORBS_WORKER === '1',

  /**
   * Desliga o bloqueio de revanche do PvP ranqueado — SÓ FORA DE PRODUÇÃO.
   *
   * Testar o PvP a sério exige duas contas, e duas contas se esbarram em `REVANCHE_MS` (10 min)
   * logo na segunda partida. Sem esta chave, conferir uma mudança na tela de batalha custa dez
   * minutos de espera por tentativa.
   *
   * A guarda é `NODE_ENV === 'development'` — POSITIVA, e não `!== 'production'`. A diferença
   * é o que separa uma trava de um enfeite: **a produção deste jogo não define `NODE_ENV`**
   * (conferido nos três serviços, no `.env` e nas units), então `!== 'production'` seria
   * verdadeiro lá e não protegeria nada. Exigindo o valor positivo, o ambiente precisa se
   * DECLARAR desenvolvimento para a chave valer; qualquer lugar que não se declare — produção
   * inclusive — fica de fora.
   *
   * O zero por MESMA CASA continua valendo em qualquer caso: isto só tira a ESPERA entre um
   * encontro e o seguinte, não a regra que impede o lucro.
   */
  pvpSemRevanche: env.PVP_SEM_REVANCHE === '1' && env.NODE_ENV === 'development',
};

export const ehGateway = config.role === 'all' || config.role === 'gateway';
export const ehSim = config.role === 'all' || config.role === 'sim';

/** Qual shard de simulação é dono deste jogador. */
export function shardDoJogador(playerId) {
  // FNV-1a: barato, determinístico e bem distribuído — todos os processos precisam
  // chegar no mesmo número para o roteamento funcionar.
  let h = 0x811c9dc5;
  const s = String(playerId);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % config.shardCount;
}
