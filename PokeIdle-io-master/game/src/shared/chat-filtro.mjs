/** Palavra proibida no chat — fan game com RMT interno, não projeto NFT. */
export const RE_CHAT_NFT = /nft/i;

export function chatContemNft(texto) {
  return RE_CHAT_NFT.test(String(texto ?? ''));
}
