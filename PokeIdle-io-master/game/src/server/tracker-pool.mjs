// O POOL DO TRACKER — as conexões que o tráfego PÚBLICO pode usar, e nada além delas.
//
// ### O problema que isto resolve, medido
//
// O Tracker nasceu consultando o `pool` do jogo (`db.mjs`, `PG_POOL_MAX` = 25 por processo).
// Numa rajada de 300 pedidos de perfis diferentes, o `pg_stat_activity` mostrou **26 conexões**
// do processo: a página pública tinha tomado o pool INTEIRO. Naquele instante, qualquer coisa
// do jogo que precisasse do banco — carregar um jogador que entrou, gravar uma partida, o
// write-behind despejando estado — ficaria na fila atrás de gente lendo uma tabela de meta.
//
// Nenhum teto por IP resolve isso sozinho: o teto vale por origem, e o pool é global. Bastam
// trinta pessoas (ou trinta IPs) para chegar lá sem nenhuma delas passar do limite. E o gatilho
// não precisa ser um ataque — é um link no Discord numa hora de pico.
//
// A separação é física: o Tracker tem um pool PRÓPRIO, pequeno, e por mais tráfego que a página
// receba o jogo continua com as 25 conexões dele. Saturado, o Tracker fica lento (ou devolve
// 503); o jogo não sente.
//
// ### Por que `statement_timeout`
//
// Uma conexão presa é pior do que uma conexão ocupada: ela não volta para o pool. Com quatro
// conexões, quatro consultas travadas deixam o Tracker sem nenhuma — e sem timeout elas ficam
// travadas até o banco ou o cliente desistir, o que pode ser "nunca". Três segundos é uma
// ordem de grandeza acima da consulta mais lenta medida aqui (13 ms, a ficha de uma espécie).
//
// ### Por que quatro
//
// As consultas do Tracker medem de 0,1 ms a alguns milissegundos, e as respostas ficam em cache.
// Quatro conexões dão folga para as ~8 consultas paralelas de uma ficha de jogador e ainda
// sustentam dezenas de visitas por segundo. Mais do que isso não compraria velocidade — compraria
// só o direito de pesar mais no banco quando alguém resolver martelar a página.
import pg from 'pg';
import { config } from './config.mjs';

/** Conexões que o tráfego público pode abrir, por processo. Ver o cabeçalho. */
const MAX = Math.max(2, Number(process.env.TRACKER_POOL_MAX ?? 4) || 4);

/** Teto de tempo de UMA consulta. Acima disso o banco a mata e devolve a conexão. */
const TIMEOUT_MS = Math.max(500, Number(process.env.TRACKER_STATEMENT_TIMEOUT_MS ?? 3000) || 3000);

export const poolTracker = new pg.Pool({
  connectionString: config.databaseUrl,
  max: MAX,
  // `application_name` separado é o que faz o `pg_stat_activity` dizer, numa olhada, se quem
  // está segurando o banco é o jogo ou a página pública.
  application_name: `pokeidle-tracker-${config.role}-${config.porta}`,
  // As opções vão na STRING de conexão do servidor, e não num `SET` depois: assim elas valem
  // desde a primeira consulta de cada conexão nova, inclusive a que o pool abre no meio de uma
  // rajada — que é justamente quando o timeout importa.
  options: `-c statement_timeout=${TIMEOUT_MS} -c idle_in_transaction_session_timeout=${TIMEOUT_MS}`,
  // Conexão parada volta para o sistema operacional em meio minuto. A página passa a maior
  // parte do dia sem tráfego nenhum; guardar quatro conexões abertas por processo, em seis
  // gateways, é desperdício de um recurso que o banco conta.
  idleTimeoutMillis: 30_000,
  // Esperar por uma conexão para sempre é como uma fila vira queda: o pedido fica pendurado, o
  // cliente reenvia, e a fila cresce. Dois segundos e o Tracker responde 503 — a página diz
  // "tente de novo" e o servidor volta ao normal sozinho.
  connectionTimeoutMillis: 2000,
});

// O mesmo motivo do listener em `db.mjs`: um `Pool` que emite `'error'` sem ninguém escutando
// DERRUBA o processo. Aqui isso seria pior do que lá — o gateway que morre leva junto todos os
// sockets de jogo que ele está servindo, por causa de uma página de estatística.
poolTracker.on('error', (err) => {
  console.error('[tracker] conexão ociosa caiu:', err.message);
});

/** Para o desligamento limpo e para os testes. */
export const fecharPoolTracker = () => poolTracker.end();
