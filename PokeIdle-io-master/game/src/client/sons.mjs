// Efeitos sonoros pontuais — o que o jogo TOCA, não o que ele toca de fundo.
//
// Nada aqui tem a ver com o Sound Mode (`musica.mjs`): aquilo é trilha, roda em laço e o
// jogador liga porque quer música. Isto é um efeito de UMA vez, atado a um acontecimento raro,
// e por isso vive num interruptor próprio. Quem joga com a trilha desligada ainda quer ouvir o
// shiny; quem joga no trabalho não quer nenhum dos dois.
//
// ### Por que não há um pool de <audio> nem AudioContext
//
// Três efeitos pontuais: captura comum (toda bola que fecha), shiny (1 em ~24.000) e a peça de
// TM que cai de boss. Não
// existe sobreposição a resolver, e um AudioContext exigiria destravar o contexto no primeiro
// gesto do usuário e mantê-lo vivo. Um `<audio>` solto por efeito, criado na primeira vez e
// reusado, resolve os dois casos.
//
// ### O autoplay do navegador
//
// Chrome e Safari recusam `play()` até a página ter recebido um gesto. Na prática o jogador
// clicou em algo muito antes de capturar qualquer coisa (entrar na hunt, arremessar bola), mas
// a recusa é possível — e um efeito de comemoração que estoura uma exceção no console e derruba
// o resto do `case 'capturado'` seria um preço absurdo por um som. Por isso `.catch(() => {})`:
// perder o som é aceitável, perder o toast e o histórico da captura não é.

const ARQUIVO_SHINY = 'img/som/shiny-captura.m4a';
const ARQUIVO_CAPTURA = 'img/som/captura.mp3';
const ARQUIVO_TM_BOSS = 'img/som/drop-tm-piece.mp3';

/** O efeito é comemoração, não alarme: alto o bastante para assustar, sem estourar. */
const VOLUME_SHINY = 0.7;
const VOLUME_CAPTURA = 0.7;
const VOLUME_TM_BOSS = 0.7;

let shinyAudio = null;
let capturaAudio = null;
let tmBossAudio = null;

function audioShiny() {
  if (shinyAudio) return shinyAudio;
  if (typeof Audio === 'undefined') return null;
  shinyAudio = new Audio(ARQUIVO_SHINY);
  shinyAudio.preload = 'auto';
  shinyAudio.volume = VOLUME_SHINY;
  return shinyAudio;
}

function audioCaptura() {
  if (capturaAudio) return capturaAudio;
  if (typeof Audio === 'undefined') return null;
  capturaAudio = new Audio(ARQUIVO_CAPTURA);
  capturaAudio.preload = 'auto';
  capturaAudio.volume = VOLUME_CAPTURA;
  return capturaAudio;
}

function audioTmBoss() {
  if (tmBossAudio) return tmBossAudio;
  if (typeof Audio === 'undefined') return null;
  tmBossAudio = new Audio(ARQUIVO_TM_BOSS);
  tmBossAudio.preload = 'auto';
  tmBossAudio.volume = VOLUME_TM_BOSS;
  return tmBossAudio;
}

function tocarEfeito(a) {
  if (!a) return;
  try {
    a.currentTime = 0;
  } catch { /* ainda não carregou; o play resolve */ }
  a.play().catch(() => { /* autoplay bloqueado — o som é opcional, o resto da captura não */ });
}

/**
 * Baixa o arquivo antes de precisar dele.
 *
 * São 72 kB, e a alternativa é o som chegar meio segundo DEPOIS da bola fechar — que é
 * justamente o momento que ele existe para marcar. Roda uma vez, no login.
 */
export function prepararSons({ shiny = true, captura = true, tmBoss = false } = {}) {
  if (shiny) audioShiny()?.load();
  if (captura) audioCaptura()?.load();
  if (tmBoss) audioTmBoss()?.load();
}

/**
 * Toca o som de captura de shiny. Só para quem capturou — quem chama é o evento de batalha
 * do próprio jogador (`case 'capturado'`), nunca o anúncio global de shiny do chat.
 */
export function tocarShinyCaptura() {
  tocarEfeito(audioShiny());
}

/**
 * Toca o som de captura comum. Só para quem capturou — shiny usa `tocarShinyCaptura`.
 */
export function tocarCaptura() {
  tocarEfeito(audioCaptura());
}

/**
 * Toca o som da TM Disk Piece (Elemental ou AoE) que caiu de um boss. Só para quem derrotou — quem
 * chama é o `bossMorto` do próprio jogador.
 */
export function tocarTmBossDrop() {
  tocarEfeito(audioTmBoss());
}
