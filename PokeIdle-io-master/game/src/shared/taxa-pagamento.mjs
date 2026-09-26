/** Taxas dos provedores de pagamento de diamantes (BRL, centavos). */
// Descontinuada em favor da Efí — mantida para recalcular pagamentos ANTIGOS com a taxa que
// valia na época. Trocar por TAXA_EFI_PCT aqui mentiria sobre quanto o LivePix realmente
// depositou naqueles pagamentos.
export const TAXA_LIVEPIX_PCT = 0.05;
export const TAXA_EFI_PCT = 0.0119; // Pix Cobrança via API — https://sejaefi.com.br/tarifas
export const TAXA_STRIPE_PCT = 0.0399;
export const TAXA_STRIPE_FIXO_CENTAVOS = 39;

/**
 * Quanto sobra após a taxa do provedor.
 * `centavos` = valor pago pelo jogador (bruto).
 *
 * A taxa é escolhida pelo PROVEDOR, e não pelo método: LivePix e Efí processam o mesmo
 * `metodo: 'pix'` com taxas bem diferentes (5% contra 1,19%), então usar `metodo` como atalho
 * faria o painel recalcular pagamento antigo do LivePix com a taxa nova da Efí — o `metodo` só
 * entra como rede de segurança para uma linha antiga sem `provedor` gravado.
 */
export function liquidoPagamentoCentavos(centavos, { metodo, provedor } = {}) {
  const bruto = Math.max(0, Math.round(Number(centavos) || 0));
  if (bruto <= 0) return 0;

  const prov = String(provedor ?? '').toLowerCase();
  const met = String(metodo ?? '').toLowerCase();

  if (prov === 'livepix') return Math.max(0, Math.round(bruto * (1 - TAXA_LIVEPIX_PCT)));
  if (prov === 'efi') return Math.max(0, Math.round(bruto * (1 - TAXA_EFI_PCT)));
  if (prov === 'stripe') {
    return Math.max(0, Math.round(bruto * (1 - TAXA_STRIPE_PCT) - TAXA_STRIPE_FIXO_CENTAVOS));
  }

  if (met === 'pix') return Math.max(0, Math.round(bruto * (1 - TAXA_EFI_PCT)));
  if (met === 'cartao') return Math.max(0, Math.round(bruto * (1 - TAXA_STRIPE_PCT) - TAXA_STRIPE_FIXO_CENTAVOS));
  return bruto;
}
