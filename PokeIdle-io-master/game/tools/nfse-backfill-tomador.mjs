#!/usr/bin/env node
// Preenche o TOMADOR da nota fiscal (nome, e-mail, CPF) nas compras de diamante ANTIGAS —
// as que aconteceram antes de a Fase 1 passar a coletar esses dados no checkout.
//
// De onde vem cada campo:
//   · cartão (Stripe) → `customer_details.name` + `.email` da sessão de checkout
//                       (guardamos o id da sessão em `provedor_ref`).
//   · PIX (Efí)       → `pagador.nome` (e o CPF, quando a Efí devolve sem máscara) do Pix
//                       recebido, consultado pelo `endToEndId` que fica em `comprovante`.
//                       Exige o escopo `pix.read` nas credenciais da Efí; sem ele, tenta o
//                       `gnExtras` da cobrança (só o nome, nem sempre presente).
//
// É SÓ LEITURA nas APIs (GET). Idempotente: só toca em coluna que está vazia. Por padrão faz
// DRY-RUN — mostra o que gravaria e não escreve nada.
//
//   node tools/nfse-backfill-tomador.mjs                    # dry-run (não grava)
//   node tools/nfse-backfill-tomador.mjs --aplicar          # grava no banco
//   node tools/nfse-backfill-tomador.mjs --provedor stripe  # só um provedor (stripe | efi)
//   node tools/nfse-backfill-tomador.mjs --limite 50        # no máximo N linhas
//   node tools/nfse-backfill-tomador.mjs --pausa 300        # ms entre chamadas (padrão 200)
import '../src/server/config.mjs';
import { cifrar } from '../src/server/cofre.mjs';

function arg(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? (process.argv[i + 1] ?? true) : undefined;
}

const APLICAR = process.argv.includes('--aplicar');
const PROVEDOR = String(arg('provedor') || '').toLowerCase();
const LIMITE = Number(arg('limite')) || 0;
const PAUSA = Number(arg('pausa')) || 200;

if (PROVEDOR && !['stripe', 'efi'].includes(PROVEDOR)) {
  console.error('  --provedor aceita "stripe" ou "efi"');
  process.exit(1);
}

const { pool } = await import('../src/server/db.mjs');
const { dadosPagadorCartao, dadosPagadorPix } = await import('../src/server/pagamentos.mjs');
const { cpfValido } = await import('../src/server/game/diamantes.mjs');

const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const vazio = (v) => v == null || String(v).trim() === '';
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

// O mesmo recorte da aba "Emissão de Notas": Efí + Stripe, a partir do 1º pagamento da Efí
// (antes disso a receita caía em conta pessoa física e não vira nota do CNPJ).
const { rows: marcoRows } = await pool.query(
  `SELECT MIN(COALESCE(pago_em, criado_em)) AS em
     FROM diamante_pagamentos WHERE status = 'pago' AND lower(provedor) = 'efi'`,
);
const marco = marcoRows[0]?.em ?? null;
if (!marco) {
  console.log('\n  Nenhum pagamento confirmado da Efí — nada a preencher.\n');
  await pool.end();
  process.exit(0);
}

const filtros = [
  `status = 'pago'`,
  `lower(provedor) IN ('efi', 'stripe')`,
  `COALESCE(pago_em, criado_em) >= $1`,
  `(tomador_nome IS NULL OR btrim(tomador_nome) = '')`,
];
const params = [marco];
if (PROVEDOR) {
  params.push(PROVEDOR);
  filtros.push(`lower(provedor) = $${params.length}`);
}
let sql = `SELECT referencia, provedor, provedor_ref, comprovante, nick,
                  tomador_nome, tomador_email, tomador_cpf,
                  COALESCE(pago_em, criado_em) AS em
             FROM diamante_pagamentos
            WHERE ${filtros.join(' AND ')}
            ORDER BY COALESCE(pago_em, criado_em) ASC`;
if (LIMITE > 0) sql += `\n            LIMIT ${LIMITE}`;

const { rows } = await pool.query(sql, params);

console.log(`\n  NFS-e — backfill do tomador (compras antigas)`);
console.log(`  modo     : ${APLICAR ? 'APLICAR (grava no banco)' : 'dry-run (não grava)'}`);
console.log(`  marco    : ${new Date(marco).toISOString()}`);
console.log(`  linhas   : ${rows.length}${PROVEDOR ? ` (só ${PROVEDOR})` : ''}\n`);

let achouNome = 0;
let achouEmail = 0;
let achouCpf = 0;
let semDados = 0;
let semChave = 0;
let erros = 0;
let gravadas = 0;
let scopePixNegado = false;

for (const r of rows) {
  const prov = String(r.provedor).toLowerCase();
  const marca = `[${prov}] ${r.referencia.slice(0, 10)}… ${r.nick}`;

  let dados = null;
  try {
    if (prov === 'stripe') {
      if (vazio(r.provedor_ref)) { console.log(`  ${marca} → sem provedor_ref, pulei`); semChave++; continue; }
      dados = await dadosPagadorCartao(r.provedor_ref);
    } else {
      if (vazio(r.comprovante) && vazio(r.referencia)) { console.log(`  ${marca} → sem chave da Efí, pulei`); semChave++; continue; }
      dados = await dadosPagadorPix({ e2eid: r.comprovante || undefined, txid: r.referencia });
      if (dados?.scopeNegado) scopePixNegado = true;  // marca o aviso, mas ainda usa o nome do fallback se veio
    }
  } catch (err) {
    console.log(`  ${marca} → erro: ${err.message}`);
    erros++;
    await dormir(PAUSA);
    continue;
  }

  if (!dados || (!dados.nome && !dados.email && !dados.cpf)) {
    console.log(`  ${marca} → sem dados no provedor`);
    semDados++;
    await dormir(PAUSA);
    continue;
  }

  const patch = {};
  if (vazio(r.tomador_nome) && dados.nome) { patch.tomador_nome = dados.nome; achouNome++; }
  if (vazio(r.tomador_email) && dados.email) { patch.tomador_email = dados.email; achouEmail++; }
  if (vazio(r.tomador_cpf) && dados.cpf) {
    // Cifrado, igual ao caminho normal da compra — senão o backfill reabriria em texto puro
    // justamente as linhas antigas que ele veio preencher.
    try { patch.tomador_cpf = cifrar(cpfValido(dados.cpf)); achouCpf++; } catch { /* CPF inválido — ignora */ }
  }

  const cols = Object.keys(patch);
  if (!cols.length) {
    console.log(`  ${marca} → nada novo (já preenchido)`);
    await dormir(PAUSA);
    continue;
  }

  const resumo = cols.map((c) => `${c.replace('tomador_', '')}="${patch[c]}"`).join(' ');
  console.log(`  ${marca} → ${resumo}${APLICAR ? '' : '  (dry-run)'}`);

  if (APLICAR) {
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    await pool.query(
      `UPDATE diamante_pagamentos SET ${sets} WHERE referencia = $1`,
      [r.referencia, ...cols.map((c) => patch[c])],
    );
    gravadas++;
  }

  await dormir(PAUSA);
}

console.log(`\n  ── resumo ──`);
console.log(`  nomes encontrados : ${achouNome}`);
console.log(`  e-mails (Stripe)  : ${achouEmail}`);
console.log(`  CPFs (Efí)        : ${achouCpf}`);
console.log(`  sem dados         : ${semDados}`);
console.log(`  sem chave         : ${semChave}`);
console.log(`  erros             : ${erros}`);
console.log(`  linhas gravadas   : ${APLICAR ? gravadas : 0}${APLICAR ? '' : '  (dry-run — rode com --aplicar para gravar)'}`);
if (scopePixNegado) {
  console.log(`\n  ⚠  A Efí recusou GET /v2/pix/:e2eid (403). Habilite o escopo "pix.read" nas`);
  console.log(`     credenciais da aplicação Pix no painel da Efí para pegar os nomes/CPFs do PIX.`);
}
console.log('');

await pool.end();
