/**
 * Ajustes nossos por cima do espelho — compartilhados entre `content.mjs` e o catálogo do cliente.
 *
 * Mora em código, e não editado direto no `creatures.json`, pelo mesmo motivo da BEAST_BALL:
 * `public/data/` é espelho regenerável e um `npm run fetch` reescreveria o arquivo.
 */
import { NIVEL_ANCORA, ouroDoNivel, xpDoNivel } from './sell-value.mjs';

export const AJUSTE_HUNT_LEVEL = {
  112: 100, // Rhydon — hunt Kanto nv 100; espelho deixou 80 (degrau do Rhyhorn)
  219: 100, // Magcargo — mesmo bug (degrau do Slugma)
  13447: 1000, // Riolu
  13448: 1250, // Lucario
  297: 700, // Hariyama — acima do Makuhita (550)
  13297: 700, // Hariyama (clone Hoenn)
  // Smeargle é de Gen 2 e mora em Johto (`hunts-johto-novos.json`); o espelho deixou
  // huntLevel 1 com `priceNpc` de 1 milhão, que é lixo de importação. 30 é o degrau dos
  // vizinhos de ilha dele — Dunsparce, Snubbull, Teddiursa —, e é daqui (e não do degrau
  // de `hunts-sinnoh.json`, que o cliente não lê) para as duas pontas verem o mesmo XP.
  235: 30, // Smeargle
};

/** Aplica `huntLevel` e, em degraus ≤150, sincroniza XP/ouro com a curva padrão. */
export function aplicarAjustesHuntLevel(obter) {
  for (const [id, nivel] of Object.entries(AJUSTE_HUNT_LEVEL)) {
    const esp = obter(Number(id));
    if (!esp) continue;
    esp.huntLevel = nivel;
    if (nivel <= NIVEL_ANCORA) {
      esp.experience = xpDoNivel(nivel);
      const ouro = ouroDoNivel(nivel);
      esp.sellValue = ouro;
      esp.priceNpc = ouro;
    }
  }
}
