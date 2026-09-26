#!/usr/bin/env node
// Cadastra a URL de notificação do Pix na Efí.
//
// Diferente do Stripe e do LivePix, a Efí não tem campo no painel para isto — o cadastro é uma
// chamada de API (`PUT /v2/webhook/:chave`). Este script existe para não depender de curl manual
// toda vez que `URL_PUBLICA` mudar (primeiro deploy, troca de domínio, etc.).
//
//   node tools/efi-configurar-webhook.mjs
//
// Roda uma vez, fora do boot do servidor — não é algo que precise acontecer a cada `npm start`.
import '../src/server/config.mjs';
import { URL_PUBLICA } from '../src/server/auth.mjs';
import { pixAtivo, configurarWebhookPix, statusWebhookPix } from '../src/server/pagamentos.mjs';

if (!pixAtivo()) {
  console.error(`
  ✗ Efí não está configurada. Faltam uma ou mais destas no .env:
      EFI_CLIENT_ID, EFI_CLIENT_SECRET, EFI_CERTIFICADO, EFI_CHAVE_PIX, EFI_WEBHOOK_SEGREDO
`);
  process.exit(1);
}

const segredo = process.env.EFI_WEBHOOK_SEGREDO.trim();
const url = `${URL_PUBLICA}/webhooks/efi/${segredo}`;

console.log(`Cadastrando webhook na Efí:\n  ${url}\n`);

try {
  await configurarWebhookPix(url);
  const status = await statusWebhookPix();
  console.log(`✓ cadastrado. A Efí confirma:\n  ${status.webhookUrl}\n`);
} catch (err) {
  console.error(`✗ falhou: ${err.message}\n`);
  process.exit(1);
}
process.exit(0);
