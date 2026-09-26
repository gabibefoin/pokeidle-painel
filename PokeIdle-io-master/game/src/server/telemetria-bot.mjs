/**
 * Sinais de automação — só REGISTRA. Não recusa, não pune, não muda nada no jogo.
 *
 * Um jogador rápido não pode virar suspeito por ser rápido: cada sinal exige um padrão que se
 * repete (várias vezes na mesma hora) e que um humano não sustenta. Quando dispara, o sim grava
 * uma linha `suspeita` na auditoria do jogador (aparece na ficha do painel) e escreve no log — o
 * resto é decisão de gente.
 *
 * Tudo mora no objeto do jogador em memória e some no logout. Custo: um push num array curto
 * por compra no mercado ou por arremesso MANUAL de bola.
 */

/** Compra "colada" na liberação do anúncio. Medido em 15/09/2026: 481 compras em < 0,5 s, a
 * maior parte de poucos compradores com mediana de 14–44 ms — reação humana não chega nisso. */
export const SNIPE_JANELA_MS = 1500;
export const SNIPE_VEZES_POR_HORA = 3;

/** Arremessos manuais: 60 seguidos com intervalo quase idêntico e reação curta à queda do mob. */
export const BOLA_AMOSTRA = 60;
export const BOLA_INTERVALO_MAX_MS = 2500;
export const BOLA_CV_MAX = 0.12;
export const BOLA_REACAO_MAX_MS = 200;
/** Ou volume que não para: tantos arremessos manuais em cada uma de duas horas seguidas. */
export const BOLA_POR_HORA = 1500;

const HORA = 3_600_000;

const mediana = (xs) => {
  if (!xs.length) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
};

function telemetria(p) {
  p.telemetriaBot ??= { snipes: [], intervalos: [], reacoes: [], ultimoArremesso: 0, arremessos: 0, horaInicio: 0, naHora: 0, horaAnterior: 0, avisos: {} };
  return p.telemetriaBot;
}

function podeAvisar(tel, acao, t) {
  if (t - (tel.avisos[acao] ?? 0) < HORA) return false;
  tel.avisos[acao] = t;
  return true;
}

/**
 * Um pedido de compra que chegou logo depois de o anúncio liberar — ganhe ou perca o sorteio da
 * liberação. `t` é quando o pedido chegou ao sim, `compravelEm` quando o anúncio saiu da retenção.
 */
export function registrarCompraMercado(p, { compravelEm, t }) {
  if (!compravelEm) return null;
  const atraso = t - compravelEm;
  if (atraso < 0 || atraso >= SNIPE_JANELA_MS) return null;
  const tel = telemetria(p);
  tel.snipes.push({ t, atraso });
  while (tel.snipes.length && t - tel.snipes[0].t > HORA) tel.snipes.shift();
  if (tel.snipes.length < SNIPE_VEZES_POR_HORA || !podeAvisar(tel, 'mercado_snipe', t)) return null;
  const med = Math.round(mediana(tel.snipes.map((s) => s.atraso)));
  return {
    acao: 'mercado_snipe',
    detalhe: `${tel.snipes.length} pedidos de compra até ${SNIPE_JANELA_MS / 1000} s depois de liberar, na última hora · mediana ${med} ms`,
  };
}

/** Um arremesso MANUAL aceito (`ball.throw` que passou do cooldown). `mortoEm` = queda do mob. */
export function registrarArremessoManual(p, { t, mortoEm }) {
  const tel = telemetria(p);

  // Volume por hora corrida.
  if (t - tel.horaInicio >= HORA) {
    tel.horaAnterior = t - tel.horaInicio < 2 * HORA ? tel.naHora : 0;
    tel.horaInicio = t;
    tel.naHora = 0;
  }
  tel.naHora += 1;

  if (tel.ultimoArremesso && t - tel.ultimoArremesso < 10_000) {
    tel.intervalos.push(t - tel.ultimoArremesso);
    if (tel.intervalos.length > BOLA_AMOSTRA) tel.intervalos.shift();
  } else {
    tel.intervalos.length = 0;
  }
  tel.ultimoArremesso = t;
  if (mortoEm) {
    tel.reacoes.push(Math.max(0, t - mortoEm));
    if (tel.reacoes.length > BOLA_AMOSTRA) tel.reacoes.shift();
  }

  if (tel.horaAnterior >= BOLA_POR_HORA && tel.naHora >= BOLA_POR_HORA && podeAvisar(tel, 'bola_volume', t)) {
    return {
      acao: 'bola_volume',
      detalhe: `${tel.horaAnterior} e ${tel.naHora} arremessos manuais em duas horas seguidas`,
    };
  }

  // A janela é recalculada a cada 20 arremessos, não a cada um: média, desvio e mediana de 60 valores
  // custavam ~2 µs por arremesso, e o padrão de máquina não some em 20 arremessos.
  tel.arremessos += 1;
  if (tel.arremessos % 20 !== 0) return null;
  if (tel.intervalos.length < BOLA_AMOSTRA || tel.reacoes.length < BOLA_AMOSTRA) return null;
  const media = tel.intervalos.reduce((s, x) => s + x, 0) / tel.intervalos.length;
  const desvio = Math.sqrt(tel.intervalos.reduce((s, x) => s + (x - media) ** 2, 0) / tel.intervalos.length);
  const cv = media ? desvio / media : 1;
  const reacao = mediana(tel.reacoes);
  if (media <= BOLA_INTERVALO_MAX_MS && cv < BOLA_CV_MAX && reacao < BOLA_REACAO_MAX_MS && podeAvisar(tel, 'bola_ritmo', t)) {
    return {
      acao: 'bola_ritmo',
      detalhe: `${BOLA_AMOSTRA} arremessos manuais seguidos · intervalo médio ${Math.round(media)} ms (variação ${(cv * 100).toFixed(1)}%) · reação mediana ${Math.round(reacao)} ms`,
    };
  }
  return null;
}
