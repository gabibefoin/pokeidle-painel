/**
 * O gateway saindo do ar de propósito — deploy, `systemctl restart`.
 *
 * ### O problema
 *
 * Sem isto, o SIGTERM derrubava o processo na hora e o navegador via a conexão cair do mesmo jeito
 * que cai numa oscilação de Wi-Fi: código 1006, sem motivo. E todo mundo daquele gateway reconectava
 * no MESMO instante, 1,5 s depois. Em produção, em 15/09/2026, os dois deploys da madrugada deram
 * 1.430 e 2.497 "hello lento" (login de 3 a 6 s) com ~1.100 jogadores; com 10 mil a rajada seria
 * oito vezes maior.
 *
 * ### A saída
 *
 * Fechar cada socket com **1012 — "Service Restart"**, o código padrão do WebSocket para isso. O
 * cliente reconhece e espalha a volta por vários segundos (ver `shared/reconexao.mjs`), enquanto uma
 * queda de rede de verdade continua voltando em 1–2 s. O Caddy e o Cloudflare repassam o quadro de
 * fechamento como qualquer outro.
 */
export const CODIGO_REINICIO = 1012;

/** Fecha com 1012 todo socket aberto. Devolve quantos fechou. */
export function fecharParaReinicio(clientes, motivo = 'reinicio') {
  let n = 0;
  for (const ws of clientes) {
    if (ws.readyState !== 1) continue;
    try {
      ws.close(CODIGO_REINICIO, motivo);
      n++;
    } catch {}
  }
  return n;
}
