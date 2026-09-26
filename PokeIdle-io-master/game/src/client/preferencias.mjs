// Preferências locais do cliente — persistidas no navegador, sem ir ao servidor.

const CHAVE_OTIMIZADO = 'cfg-otimizado';
const CHAVE_NIGHT = 'cfg-night';
const CHAVE_IMERSIVO = 'cfg-imersivo';
const CHAVE_ECONOMIA = 'cfg-economia';
const CHAVE_TELA_ACESA = 'cfg-tela-acesa';
const CHAVE_SOM = 'cfg-som';
const CHAVE_SOM_SHINY = 'cfg-som-shiny';
const CHAVE_SOM_CAPTURA = 'cfg-som-captura';
const CHAVE_SOM_TM_BOSS = 'cfg-som-tm-boss';
const CHAVE_GOLPES_HUD = 'cfg-golpes-hud';

export function otimizadoLigado() {
  try {
    return localStorage.getItem(CHAVE_OTIMIZADO) === '1';
  } catch {
    return false;
  }
}

export function definirOtimizado(ligado) {
  try {
    localStorage.setItem(CHAVE_OTIMIZADO, ligado ? '1' : '0');
  } catch { /* privado / quota */ }
}

export function nightLigado() {
  try {
    return localStorage.getItem(CHAVE_NIGHT) === '1';
  } catch {
    return false;
  }
}

/** Aplica ou remove o tema escuro em todo o site (portal + jogo). */
export function aplicarNight(ligado) {
  try {
    localStorage.setItem(CHAVE_NIGHT, ligado ? '1' : '0');
  } catch { /* privado / quota */ }
  document.documentElement.classList.toggle('night-mode', ligado);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = ligado ? '#0d0a10' : '#2a1520';
}

export function imersivoLigado() {
  try {
    return localStorage.getItem(CHAVE_IMERSIVO) === '1';
  } catch {
    return false;
  }
}

/** Esconde HUD e painéis — só a cena de batalha em tela cheia. */
export function aplicarImersivo(ligado) {
  try {
    localStorage.setItem(CHAVE_IMERSIVO, ligado ? '1' : '0');
  } catch { /* privado / quota */ }
  document.documentElement.classList.toggle('modo-imersivo', ligado);
}

export function definirImersivo(ligado) {
  aplicarImersivo(ligado);
}

export function economiaLigado() {
  try {
    return localStorage.getItem(CHAVE_ECONOMIA) === '1';
  } catch {
    return false;
  }
}

/**
 * MODO ECONOMIA — a cena sai do ar e sobra o painel de números.
 *
 * Não é o Modo otimizado com outro nome. Aquele desliga os ENFEITES (animação de golpe,
 * número de dano) e continua desenhando o mapa, os sprites e todo mundo andando, 60 vezes por
 * segundo. Este desliga o DESENHO: o laço de quadro para, o mapa e os sprites são soltos da
 * memória e o servidor deixa de mandar o campo (ver `cliente.economia` no protocolo). O que
 * fica é o que o jogador de idle de fato acompanha — o que ele ganhou por hora e o que ele
 * capturou —, e o farm continua do lado de lá como sempre.
 *
 * A classe mora no `<html>`, como as outras, e o `index.html` a acende antes do primeiro
 * quadro: entrar no jogo já sem cena é diferente de desenhar a cena e apagá-la em seguida.
 */
export function aplicarEconomia(ligado) {
  try {
    localStorage.setItem(CHAVE_ECONOMIA, ligado ? '1' : '0');
  } catch { /* privado / quota */ }
  document.documentElement.classList.toggle('modo-economia', ligado);
}

/**
 * TELA SEMPRE ACESA (celular). Nasce DESLIGADA, ao contrário dos sons: segurar a tela acesa é
 * gastar a bateria da tela, e esse preço o jogador aceita ligando — não descobre depois. Quem
 * guarda a trava de verdade é `tela-acesa.mjs`; isto é só a escolha.
 */
export function telaAcesaLigado() {
  try {
    return localStorage.getItem(CHAVE_TELA_ACESA) === '1';
  } catch {
    return false;
  }
}

export function definirTelaAcesa(ligado) {
  try {
    localStorage.setItem(CHAVE_TELA_ACESA, ligado ? '1' : '0');
  } catch { /* privado / quota */ }
}

export function somLigado() {
  try {
    return localStorage.getItem(CHAVE_SOM) === '1';
  } catch {
    return false;
  }
}

/** Sound Mode — trilhas Hoenn com player flutuante. */
export function aplicarSom(ligado) {
  try {
    localStorage.setItem(CHAVE_SOM, ligado ? '1' : '0');
  } catch { /* privado / quota */ }
  document.documentElement.classList.toggle('som-ativo', ligado);
}

export function definirSom(ligado) {
  aplicarSom(ligado);
}

/**
 * O efeito de captura de shiny. Nasce LIGADO, ao contrário do resto daqui.
 *
 * Os outros interruptores mudam a tela toda e por isso pedem consentimento antes; este toca
 * uma vez a cada milhares de encontros, é a comemoração que o jogador pediu, e nascer desligado
 * significaria que ninguém ouviria sem antes descobrir a opção. Quem não quer, desliga uma vez.
 * A ausência da chave é o padrão — só `'0'` explícito silencia.
 */
export function somShinyLigado() {
  try {
    return localStorage.getItem(CHAVE_SOM_SHINY) !== '0';
  } catch {
    return true;
  }
}

export function definirSomShiny(ligado) {
  try {
    localStorage.setItem(CHAVE_SOM_SHINY, ligado ? '1' : '0');
  } catch { /* privado / quota */ }
}

/**
 * O efeito de captura comum. Nasce LIGADO, como o de shiny: quem não quiser desliga nas
 * configurações. Shiny continua com o som próprio — este não toca quando a captura brilha.
 */
export function somCapturaLigado() {
  try {
    return localStorage.getItem(CHAVE_SOM_CAPTURA) !== '0';
  } catch {
    return true;
  }
}

export function definirSomCaptura(ligado) {
  try {
    localStorage.setItem(CHAVE_SOM_CAPTURA, ligado ? '1' : '0');
  } catch { /* privado / quota */ }
}

/**
 * O efeito da TM DISK PIECE que cai de boss (Elemental ou AoE). Nasce LIGADO, como os de captura:
 * a peça é o que se vai buscar no boss, e o som marca que ela veio. Quem não quiser desliga nas
 * configurações. A ausência da chave é o padrão — só `'0'` explícito silencia.
 */
export function somTmBossLigado() {
  try {
    return localStorage.getItem(CHAVE_SOM_TM_BOSS) !== '0';
  } catch {
    return true;
  }
}

export function definirSomTmBoss(ligado) {
  try {
    localStorage.setItem(CHAVE_SOM_TM_BOSS, ligado ? '1' : '0');
  } catch { /* privado / quota */ }
}

/**
 * O painel de golpes do palco (ícone de tipo + relógio de cooldown, ao lado da batalha).
 * Nasce LIGADO, como o som de shiny: é enfeite informativo, não uma mudança de tela — quem não
 * quiser vai lá e desliga uma vez. A ausência da chave é o padrão — só `'0'` explícito esconde.
 */
export function golpesHudLigado() {
  try {
    return localStorage.getItem(CHAVE_GOLPES_HUD) !== '0';
  } catch {
    return true;
  }
}

export function definirGolpesHud(ligado) {
  try {
    localStorage.setItem(CHAVE_GOLPES_HUD, ligado ? '1' : '0');
  } catch { /* privado / quota */ }
}

if (typeof document !== 'undefined') {
  aplicarNight(nightLigado());
  aplicarImersivo(imersivoLigado());
  aplicarEconomia(economiaLigado());
  aplicarSom(somLigado());
}
