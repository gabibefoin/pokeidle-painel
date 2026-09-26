/**
 * Domínios aceitos em cadastro, login e OAuth — bloqueia caixas temporárias e provedores aleatórios.
 */
export const DOMINIOS_EMAIL_CADASTRO = Object.freeze([
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'yahoo.com',
  'yahoo.com.br',
  'icloud.com',
]);

const FORMATO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailPermitidoCadastro(email) {
  const norm = String(email ?? '').trim().toLowerCase();
  if (!FORMATO.test(norm)) return false;
  return DOMINIOS_EMAIL_CADASTRO.includes(norm.split('@')[1]);
}
