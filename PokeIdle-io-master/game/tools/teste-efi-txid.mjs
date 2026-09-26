#!/usr/bin/env node
// Consulta uma cobrança Pix na Efí pelo txid — o mesmo que fica gravado como `referencia` em
// `diamante_pagamentos`. Serve para depurar "paguei e não caiu": confirma direto na API deles
// se a cobrança já fechou, sem esperar webhook nem reconciliação.
//
//   node tools/teste-efi-txid.mjs TXID
import '../src/server/config.mjs';
import { consultarPix } from '../src/server/pagamentos.mjs';

const txid = process.argv[2];
if (!txid) {
  console.error('uso: node tools/teste-efi-txid.mjs TXID');
  process.exit(1);
}
try {
  const r = await consultarPix(txid);
  console.log(JSON.stringify(r, null, 2));
} catch (e) {
  console.error('ERR', e.message, 'status=', e.status);
  process.exit(2);
}
