/**
 * Quanto o cliente espera antes de reconectar o socket.
 *
 * Duas situações bem diferentes chegam ao `onclose`, e tratar as duas igual era o erro:
 *
 *   · **a rede do jogador piscou** (1006 e afins) — ele está sozinho nisso e quer voltar LOGO:
 *     primeira tentativa entre 0,8 e 2,5 s, perto do 1,5 s fixo de antes;
 *   · **o servidor reiniciou** (1012, ver `server/encerrar-gateway.mjs`) — TODO mundo daquele
 *     gateway caiu no mesmo instante. Com o 1,5 s fixo, todos voltavam no mesmo segundo e o login
 *     virava fila: em 15/09/2026, 2.497 "hello lento" numa hora de deploy, com ~1.100 jogadores.
 *     Aqui a volta se espalha por 1 a 15 s — 10 mil jogadores viram ~700 logins por segundo.
 *
 * Da segunda tentativa em diante (o servidor ainda não voltou, ou a rede segue fora) a espera dobra
 * a cada falha até 30 s, com metade dela sorteada — sem o sorteio, quem caiu junto continuaria
 * tentando junto para sempre.
 */
export const REINICIO = 1012;

export function atrasoDeReconexao({ tentativa = 1, codigo = 0, aleatorio = Math.random } = {}) {
  const n = Math.max(1, Math.floor(Number(tentativa)) || 1);
  if (n === 1) {
    if (codigo === REINICIO) return Math.round(1000 + aleatorio() * 14_000);
    return Math.round(800 + aleatorio() * 1700);
  }
  const teto = Math.min(30_000, 2000 * 2 ** (n - 2));
  return Math.round(teto / 2 + aleatorio() * (teto / 2));
}
