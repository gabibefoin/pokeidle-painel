// TELA SEMPRE ACESA — o Screen Wake Lock, para o celular não apagar a tela com o jogo aberto.
//
// ### Por que só no celular
//
// No celular, tela apagada é aba em segundo plano: o iOS suspende a página quase na hora e o
// Android congela os timers pouco depois. O socket morre, a carência de 90 s do sim
// (`GRACA_DESCONEXAO_MS`) passa e o treinador sai do mundo — a caça para. No computador isso
// não acontece: aba minimizada ou atrás de outra janela continua com o socket vivo, porque o
// ping NATIVO do gateway é respondido pelo próprio navegador, sem precisar de JS rodando.
//
// ### O que isto NÃO faz
//
// Não segura o botão de desligar nem a troca de aplicativo — só o apagar AUTOMÁTICO por falta
// de toque. É o que a API permite, e é o caso que derruba quem deixa o celular na mesa caçando.
//
// ### O custo
//
// O pedido em si é de graça: é uma bandeira para o sistema, sem laço, sem timer, sem nada
// rodando. O que gasta é a TELA acesa, que é o maior consumo de um telefone — e isso nenhum
// código evita. Por isso o interruptor nasce DESLIGADO (quem liga aceita o preço) e a descrição
// dele manda para o Modo Economia, que tira o resto: sem cena, o jogo quase não usa CPU.
//
// ### A trava cai sozinha
//
// O navegador SOLTA a trava toda vez que a página some (outro app, aba trocada, tela bloqueada
// no botão) e não a devolve. Daí os dois ganchos: voltar a ficar visível pede de novo, e um
// toque qualquer também — alguns navegadores só atendem o pedido dentro de um gesto, e o toque
// seguinte do jogador é o primeiro gesto que aparece.
//
// O estado fica exposto em `<html data-tela-acesa>` (`presa` | `pedida` | `solta`), como o
// `data-zoom` do palco: é o que se olha para depurar num aparelho e o que o teste confere.

/** O jogador quer a tela acesa? (A trava pode estar solta mesmo assim — ver acima.) */
let querer = false;
/** O `WakeLockSentinel` em mãos, ou `null`. */
let trava = null;
/** Um pedido em voo. Dois ao mesmo tempo dariam duas travas e só uma seria solta. */
let pedindo = null;

/** O navegador tem a API? Exige contexto seguro — no ar é HTTPS, em dev é `localhost`. */
export const telaAcesaSuportada = () =>
  typeof navigator !== 'undefined' && 'wakeLock' in navigator && !!globalThis.isSecureContext;

function marcar() {
  document.documentElement.dataset.telaAcesa = trava ? 'presa' : querer ? 'pedida' : 'solta';
}

/** Pede a trava, se fizer sentido agora. Devolve se ela está presa ao fim. */
function pedir() {
  if (!querer || trava || !telaAcesaSuportada() || document.visibilityState !== 'visible') {
    return Promise.resolve(!!trava);
  }
  pedindo ??= navigator.wakeLock.request('screen')
    .then((t) => {
      // Desligou enquanto o pedido voava: devolve na hora em vez de segurar sem ninguém querer.
      if (!querer) {
        t.release().catch(() => {});
        return;
      }
      trava = t;
      t.addEventListener('release', () => {
        if (trava === t) trava = null;
        marcar();
      });
    })
    // Recusado: sem gesto, economia de bateria do aparelho, página escondida no meio do caminho.
    // Não é erro — o próximo toque ou a próxima volta à página tenta de novo.
    .catch(() => {})
    .finally(() => {
      pedindo = null;
      marcar();
    });
  return pedindo.then(() => !!trava);
}

/**
 * Liga ou desliga. Ligar dentro de um clique é o caminho mais garantido: o clique é o gesto
 * que os navegadores mais exigentes pedem. Devolve se a trava ficou presa.
 */
export function manterTelaAcesa(ligado) {
  querer = !!ligado;
  if (querer) return pedir();
  const t = trava;
  trava = null;
  t?.release().catch(() => {});
  marcar();
  return Promise.resolve(false);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pedir();
  });
  // Um teste de bandeira por toque, e só enquanto a trava estiver faltando.
  document.addEventListener('pointerdown', () => {
    if (querer && !trava) pedir();
  }, { passive: true, capture: true });
  marcar();
}
