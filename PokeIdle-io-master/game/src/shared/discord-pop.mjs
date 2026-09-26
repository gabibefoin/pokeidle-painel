/** Campanha atual do pop-up Discord (banner, evento, etc.). Subir a cada anúncio novo. */
export const DISCORD_POP_CAMPANHA = 3;

/** @param {number|undefined|null} campanhaVista última campanha que o jogador dispensou */
export function discordPopDeveMostrar(campanhaVista) {
  return (campanhaVista ?? 0) < DISCORD_POP_CAMPANHA;
}
