#!/usr/bin/env node
// Emite as NFS-e das compras de diamante do PokéIdle direto no emissor da Contabilizei.
//
// A API é a mesma que o painel (app.contabilizei.com.br) usa por baixo:
//   GET  /api/plataforma/novo-emissor/listagem/init        -> prestador + certificado
//   GET  /api/plataforma/novo-emissor/emissao/atividades   -> CNAEs habilitados (idCnaeEmpresa)
//   GET  /api/plataforma/novo-emissor/listagem/notas       -> notas já emitidas
//   GET  /api/plataforma/novo-emissor/tomador/{cpfCnpj}    -> 200 = cadastrado, 204 = não existe
//   POST /api/plataforma/novo-emissor/clientes/salvar-cliente-nacional
//   POST /api/plataforma/novo-emissor/emissao/nova-nota    -> EMITE (irreversível)
//
// Autenticação: o cookie `oauth-token` do painel, que expira em poucos minutos. Prefira pôr
//   CONTABILIZEI_USUARIO / CONTABILIZEI_SENHA  no game/.env (gitignored)
// que a ferramenta faz login sozinha e renova o token no meio da rodada. Alternativa manual:
// CONTABILIZEI_TOKEN=... ou --token <cookie>.
//
// Uso:
//   node game/tools/contabilizei-emitir.mjs --csv "..." --valor bruto            (dry-run)
//   node game/tools/contabilizei-emitir.mjs --csv "..." --valor bruto --emitir   (emite)
//
// Opções:
//   --csv <arquivo>       CSV exportado pela aba "Emissão de Notas" do admin (obrigatório)
//   --valor bruto|liquido Base de cálculo da nota (obrigatório, de propósito sem padrão)
//   --tomador auto|nenhum auto = usa CPF quando existe; nenhum = tudo "sem tomador" (padrão auto)
//   --emitir              Sai do dry-run e emite de verdade
//   --limite N            Emite no máximo N notas nesta rodada
//   --pausa MS            Intervalo entre emissões (padrão 2500)
//   --pular-ref a,b,c     Referências a ignorar
//   --ledger <arquivo>    Registro do que já foi emitido (padrão game/tools/.contabilizei-emitidas.json)

import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://app.contabilizei.com.br/api/plataforma';
const CNAE_PADRAO = '02692'; // Elaboração de software, inclusive jogos eletrônicos (CNAE 6202-3/00)

// ---------------------------------------------------------------- argumentos

function lerArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const chave = a.slice(2);
    const proximo = argv[i + 1];
    if (proximo && !proximo.startsWith('--')) { args[chave] = proximo; i++; }
    else args[chave] = true;
  }
  return args;
}

// Node 24 lê .env nativo — sem dependência nova. O game/.env já é gitignored.
for (const p of [path.join(process.cwd(), 'game', '.env'), path.join(process.cwd(), '.env')]) {
  try { process.loadEnvFile(p); break; } catch { /* sem .env aqui, segue */ }
}

const args = lerArgs(process.argv);
const USUARIO = process.env.CONTABILIZEI_USUARIO;
const SENHA = process.env.CONTABILIZEI_SENHA;
let TOKEN = args.token || process.env.CONTABILIZEI_TOKEN;
const EMITIR = args.emitir === true;
const PAUSA = Number(args.pausa || 2500);
const LIMITE = args.limite ? Number(args.limite) : Infinity;
const PULAR = new Set(String(args['pular-ref'] || '').split(',').map((s) => s.trim()).filter(Boolean));
const LEDGER = args.ledger || path.join(process.cwd(), 'game', 'tools', '.contabilizei-emitidas.json');
const MODO_TOMADOR = args.tomador || 'auto';

function morrer(msg) { console.error(`\n  ERRO: ${msg}\n`); process.exit(1); }

if (!TOKEN && !(USUARIO && SENHA)) {
  morrer('sem credencial. Ponha CONTABILIZEI_USUARIO e CONTABILIZEI_SENHA no game/.env (recomendado, faz login sozinho), ou passe --token <cookie oauth-token>.');
}
if (!args.csv) morrer('faltou --csv <arquivo>');
if (args.valor !== 'bruto' && args.valor !== 'liquido') {
  morrer('faltou --valor bruto|liquido. Isso muda a receita declarada de TODAS as notas — não tem padrão.');
}
if (!['auto', 'nenhum'].includes(MODO_TOMADOR)) morrer('--tomador aceita "auto" ou "nenhum"');

const USAR_BRUTO = args.valor === 'bruto';

// ---------------------------------------------------------------- http

const RAIZ = 'https://app.contabilizei.com.br';

// O cookie do painel expira em poucos minutos. Com usuário/senha no .env dá para renovar sozinho
// no meio da rodada, em vez de derrubar uma emissão de 200+ notas pela metade.
async function login() {
  if (!(USUARIO && SENHA)) return false;
  const pagina = await fetch(`${RAIZ}/login`, { headers: { Accept: 'text/html' } });
  const html = await pagina.text();
  const csrf = html.match(/name="token"\s+value="([^"]+)"/)?.[1];
  if (!csrf) { console.log('  login: não achei o token do formulário — o painel mudou?'); return false; }
  const cookiesDaPagina = (pagina.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0]).join('; ');

  const res = await fetch(`${RAIZ}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookiesDaPagina ? { Cookie: cookiesDaPagina } : {}),
    },
    body: new URLSearchParams({ user: USUARIO, password: SENHA, token: csrf }).toString(),
  });
  const novo = (res.headers.getSetCookie?.() || [])
    .map((c) => c.match(/^oauth-token=([^;]+)/)?.[1])
    .filter(Boolean)
    .pop();
  if (!novo) {
    console.log(`  login: não veio oauth-token (HTTP ${res.status}). Confira CONTABILIZEI_USUARIO/SENHA.`);
    return false;
  }
  TOKEN = novo;
  return true;
}

async function requisicao(metodo, caminho, corpo) {
  const res = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      Cookie: `oauth-token=${TOKEN}`,
      Accept: 'application/json',
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await res.text();
  let dados = null;
  if (texto) { try { dados = JSON.parse(texto); } catch { dados = texto; } }
  return { status: res.status, ok: res.ok, dados };
}

async function api(metodo, caminho, corpo) {
  if (!TOKEN && !(await login())) morrer('não consegui autenticar.');
  let r = await requisicao(metodo, caminho, corpo);
  if ((r.status === 401 || r.status === 403) && USUARIO && SENHA) {
    console.log('  (token expirou, refazendo login...)');
    if (await login()) r = await requisicao(metodo, caminho, corpo);
  }
  return r;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- csv

function lerCsv(arquivo) {
  const bruto = fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, '');
  const linhas = bruto.split(/\r?\n/).filter((l) => l.trim());
  const cabecalho = linhas[0].split(';').map((h) => h.trim());
  const campos = (linha) => {
    const saida = [];
    let atual = '';
    let aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (c === '"') {
        if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas;
      } else if (c === ';' && !aspas) { saida.push(atual); atual = ''; }
      else atual += c;
    }
    saida.push(atual);
    return saida;
  };
  return linhas.slice(1).map((l) => {
    const c = campos(l);
    return Object.fromEntries(cabecalho.map((h, i) => [h, (c[i] ?? '').trim()]));
  });
}

const paraNumero = (s) => Number(String(s || '0').replace(/\./g, '').replace(',', '.'));
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

function cpfValido(cpf) {
  const c = soDigitos(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(c[i]) * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== Number(c[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(c[i]) * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === Number(c[10]);
}

// ---------------------------------------------------------------- ledger

function lerLedger() {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return {}; }
}
function gravarLedger(ledger) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2), 'utf8');
}

// ---------------------------------------------------------------- nota

function montarNota(p, idCnaeEmpresa) {
  return {
    cpfCnpj: p.cpf,                 // null => "Sem Tomador Informado"
    discriminacao: p.discriminacao,
    enviarEmailTomador: false,
    idCnaeEmpresa,
    valorServico: p.valor,
    issRetido: false,
    aliquotaIssRetido: null,
    inscricaoMunicipal: null,
    incidenciaExterior: false,
    valorIss: null,
    servicoExportacao: false,
  };
}

// ---------------------------------------------------------------- principal

const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function main() {
  console.log('\n=== Emissão de NFS-e · PokéIdle → Contabilizei ===\n');

  // 1. prestador + certificado
  const init = await api('GET', '/novo-emissor/listagem/init');
  if (init.status === 401 || init.status === 403) morrer('token inválido ou expirado. Pegue o cookie oauth-token de novo no painel.');
  if (!init.ok) morrer(`listagem/init respondeu ${init.status}: ${JSON.stringify(init.dados).slice(0, 300)}`);
  const { user, certificadoDigital, emissorEnabled } = init.dados;
  console.log(`Prestador ......... ${user.razaoSocial}`);
  console.log(`CNPJ / CCM ........ ${user.cnpj} / ${user.inscricaoMunicipal}`);
  console.log(`Município ......... ${user.endereco.municipio.nome}-${user.endereco.uf.id} (${user.regimeTributario})`);
  console.log(`Certificado ....... ${certificadoDigital.vencido ? 'VENCIDO' : 'válido'} até ${certificadoDigital.dataVencimento}`);
  if (certificadoDigital.vencido) morrer('certificado digital vencido — renove antes de emitir.');
  if (!emissorEnabled) morrer('emissor desabilitado na conta.');

  // 2. atividade / CNAE
  const ativ = await api('GET', '/novo-emissor/emissao/atividades');
  if (!ativ.ok) morrer(`atividades respondeu ${ativ.status}`);
  const atividade = ativ.dados.find((a) => a.codigo === CNAE_PADRAO) || ativ.dados.find((a) => a.principal);
  const carac = atividade.caracteristicas[0];
  const idCnaeEmpresa = String(carac.dadosParaEmissao.idCnaeEmpresa);
  const aliquotaISS = carac.dadosParaCalculo.aliquotaISS;
  const aliquotaSimples = carac.dadosParaCalculo.aliquotaApresentacao;
  console.log(`Atividade ......... ${atividade.codigo} · ${carac.descricao.split('\n')[0]}`);
  console.log(`ISS ............... ${aliquotaISS}%  ·  Simples (apresentação) ${aliquotaSimples}%`);

  // 3. notas já no emissor
  const jaEmitidas = await api('GET', '/novo-emissor/listagem/notas');
  const listaRemota = Array.isArray(jaEmitidas.dados) ? jaEmitidas.dados : [];
  const ledger = lerLedger();
  const refsNoLedger = new Set(Object.keys(ledger));
  const numerosDoLedger = new Set(Object.values(ledger).map((n) => String(n.numero)));
  const forasDoLedger = listaRemota.filter((n) => !numerosDoLedger.has(String(n.numero)));
  console.log(`\nNo emissor ........ ${listaRemota.length} nota(s) emitida(s); ${refsNoLedger.size} no ledger local`);
  if (forasDoLedger.length) {
    console.log(`\n  ATENÇÃO: ${forasDoLedger.length} nota(s) existem no emissor mas não estão no ledger:`);
    for (const n of forasDoLedger.slice(0, 10)) {
      console.log(`    nº ${n.numero} · ${n.dataEmissaoFormatada} · ${brl(n.valorServico)} · ${n.nomeRazaoTomador} · ${n.statusNotaFiscal?.text}`);
    }
    console.log('    Se alguma corresponde a uma linha do CSV, use --pular-ref <referencia> para não duplicar.');
    console.log('    (Só aviso. A proteção real contra duplicata é o ledger, linha a linha.)');
  }

  // 4. plano a partir do CSV
  const linhas = lerCsv(args.csv);
  const plano = [];
  const puladas = [];
  for (const l of linhas) {
    const ref = l.Referencia;
    const valor = Number((USAR_BRUTO ? paraNumero(l.ValorBruto) : paraNumero(l.ValorLiquido)).toFixed(2));
    const cpf = soDigitos(l.CPF);
    if (PULAR.has(ref)) { puladas.push({ ref, motivo: '--pular-ref' }); continue; }
    if (refsNoLedger.has(ref)) { puladas.push({ ref, motivo: `já emitida (nº ${ledger[ref].numero})` }); continue; }
    if (!(valor > 0)) { puladas.push({ ref, motivo: 'valor zero/inválido' }); continue; }
    if (cpf && !cpfValido(cpf)) { puladas.push({ ref, motivo: `CPF inválido (${l.CPF})` }); continue; }
    plano.push({
      ref,
      data: l.Data,
      provedor: l.Provedor,
      valor,
      cpf: MODO_TOMADOR === 'auto' && cpfValido(cpf) ? cpf : null,
      nome: (l.Tomador || '').trim() || null,
      email: (l.Email || '').trim() || null,
      discriminacao: l.Descricao,
    });
  }

  const comTomador = plano.filter((p) => p.cpf);
  const semTomador = plano.filter((p) => !p.cpf);
  const total = plano.reduce((a, p) => a + p.valor, 0);

  console.log(`\n--- Plano (base de cálculo: valor ${USAR_BRUTO ? 'BRUTO' : 'LÍQUIDO'}) ---`);
  console.log(`Linhas no CSV ..... ${linhas.length}`);
  console.log(`A emitir .......... ${plano.length}`);
  console.log(`  com tomador ..... ${comTomador.length} (${new Set(comTomador.map((p) => p.cpf)).size} CPF distintos)`);
  console.log(`  sem tomador ..... ${semTomador.length}`);
  console.log(`Puladas ........... ${puladas.length}`);
  for (const p of puladas.slice(0, 15)) console.log(`    ${p.ref} — ${p.motivo}`);
  if (puladas.length > 15) console.log(`    ... e mais ${puladas.length - 15}`);
  console.log(`Valor total ....... ${brl(total)}`);
  console.log(`ISS previsto ...... ${brl(total * aliquotaISS / 100)}`);
  console.log(`Simples previsto .. ${brl(total * aliquotaSimples / 100)}`);

  // 5. tomadores que precisam de cadastro
  const porCpf = new Map();
  for (const p of comTomador) if (!porCpf.has(p.cpf)) porCpf.set(p.cpf, p);
  const aCadastrar = [];
  if (porCpf.size) {
    console.log(`\nVerificando ${porCpf.size} tomador(es) no cadastro...`);
    for (const [, p] of porCpf) {
      const r = await api('GET', `/novo-emissor/tomador/${p.cpf}`);
      if (r.status === 204) aCadastrar.push(p);
      await dormir(300);
    }
    console.log(`  já cadastrados .. ${porCpf.size - aCadastrar.length}`);
    console.log(`  a cadastrar ..... ${aCadastrar.length}`);
    const semNome = aCadastrar.filter((p) => !p.nome);
    if (semNome.length) console.log(`  ⚠ ${semNome.length} sem nome no CSV — essas notas sairão SEM TOMADOR.`);
  }
  const semCadastroPossivel = new Set(aCadastrar.filter((p) => !p.nome).map((p) => p.cpf));

  if (plano[0]) {
    console.log('\n--- Exemplo de payload (1ª nota) ---');
    console.log(JSON.stringify(montarNota(plano[0], idCnaeEmpresa), null, 2));
  }

  if (!EMITIR) {
    console.log('\n>>> DRY-RUN. Nada foi emitido. Repita com --emitir para valer.\n');
    return;
  }

  // 6. cadastra tomadores
  for (const p of aCadastrar) {
    if (!p.nome) continue;
    // Formato do ClienteNacionalDTO (6 campos), extraído do submit de PF do painel.
    const corpo = {
      cpfCnpj: p.cpf,
      razaoSocialOuNome: p.nome,
      telefone: '',
      email: p.email || '',
      inscricaoMunicipal: null,
      endereco: { bairro: '', cep: '', codIbge: '', complemento: '', logradouro: '', estado: '', numero: '', cepInvalido: false },
    };
    const r = await api('POST', '/novo-emissor/clientes/salvar-cliente-nacional', corpo);
    console.log(`  cadastro ${p.cpf} ${p.nome} -> ${r.status}${r.ok ? '' : ' ' + JSON.stringify(r.dados).slice(0, 500)}`);
    if (!r.ok) semCadastroPossivel.add(p.cpf);
    await dormir(PAUSA);
  }

  // 7. emite
  const aEmitir = plano.slice(0, LIMITE === Infinity ? plano.length : LIMITE);
  console.log(`\n--- Emitindo ${aEmitir.length} nota(s) ---\n`);
  let ok = 0, falhas = 0, seguidas = 0;
  for (const [i, p] of aEmitir.entries()) {
    if (p.cpf && semCadastroPossivel.has(p.cpf)) p.cpf = null;
    const corpo = montarNota(p, idCnaeEmpresa);
    const r = await api('POST', '/novo-emissor/emissao/nova-nota?origem=EMISSOR_SIMPLIFICADO_EMISSAO', corpo);
    const rotulo = `[${i + 1}/${aEmitir.length}] ${p.ref.slice(0, 8)} ${brl(p.valor)} ${p.cpf || 'sem tomador'}`;
    if (r.ok) {
      ok++; seguidas = 0;
      const d = r.dados || {};
      ledger[p.ref] = {
        numero: d.numero ?? null,
        id: d.id ?? null,
        valor: p.valor,
        base: USAR_BRUTO ? 'bruto' : 'liquido',
        cpf: p.cpf,
        emitidaEm: new Date().toISOString(),
        resposta: d,
      };
      gravarLedger(ledger);
      console.log(`  ok    ${rotulo} -> nº ${d.numero ?? '?'}`);
    } else if (r.status === 401 || r.status === 403) {
      // Só chega aqui sem usuário/senha no .env — com eles, api() já teria refeito o login.
      console.log(`  FALHA ${rotulo} -> ${r.status} token expirado`);
      console.log('\n  Token expirou no meio da rodada e não há CONTABILIZEI_USUARIO/SENHA no .env');
      console.log('  para renovar sozinho. Pegue o oauth-token de novo e rode o mesmo comando:');
      console.log('  o ledger retoma exatamente de onde parou.');
      falhas++;
      break;
    } else {
      falhas++; seguidas++;
      console.log(`  FALHA ${rotulo} -> ${r.status} ${JSON.stringify(r.dados).slice(0, 300)}`);
      if (seguidas >= 3) { console.log('\n  3 falhas seguidas — parando. Ledger salvo; é seguro rodar de novo.'); break; }
    }
    await dormir(PAUSA);
  }

  if (ok) await reconciliarNumeros(ledger);
  console.log(`\n=== Fim: ${ok} emitida(s), ${falhas} falha(s). Ledger em ${LEDGER} ===\n`);
}

// O POST de emissão responde vazio, sem o número da nota. As notas são numeradas na ordem em
// que saem, então casa-se a listagem (ordenada por número) com o ledger (ordenado por emissão),
// conferindo o valor de cada uma antes de gravar.
async function reconciliarNumeros(ledger) {
  const r = await api('GET', '/novo-emissor/listagem/notas');
  if (!r.ok || !Array.isArray(r.dados)) {
    console.log(`\n  Não deu para reconciliar os números (listagem respondeu ${r.status}).`);
    return;
  }
  const jaNoLedger = new Set(Object.values(ledger).map((n) => String(n.numero)).filter((n) => n !== 'null'));
  const livres = r.dados
    .filter((n) => !jaNoLedger.has(String(n.numero)))
    .sort((a, b) => Number(a.numero) - Number(b.numero));
  const pendentes = Object.entries(ledger)
    .filter(([, v]) => v.numero == null)
    .sort((a, b) => String(a[1].emitidaEm).localeCompare(String(b[1].emitidaEm)));

  let casadas = 0;
  for (let i = 0; i < Math.min(livres.length, pendentes.length); i++) {
    const remota = livres[i];
    const [ref, local] = pendentes[i];
    if (Math.abs(Number(remota.valorServico) - local.valor) > 0.005) {
      console.log(`\n  Reconciliação parou em ${ref}: nº ${remota.numero} vale ${brl(remota.valorServico)}, esperado ${brl(local.valor)}.`);
      break;
    }
    ledger[ref].numero = remota.numero;
    ledger[ref].situacao = remota.situacaoNota;
    ledger[ref].status = remota.statusNotaFiscal?.text ?? null;
    ledger[ref].erros = remota.errosNotaFiscal ?? null;
    casadas++;
  }
  if (casadas) gravarLedger(ledger);

  const comErro = r.dados.filter((n) => n.errosNotaFiscal || (n.situacaoNota && n.situacaoNota !== 'PROCESSADO_SUCESSO'));
  console.log(`\n  Reconciliadas ${casadas} nota(s) com o número do emissor.`);
  console.log(`  No emissor: ${r.dados.length} nota(s), ${r.dados.length - comErro.length} processada(s) com sucesso.`);
  for (const n of comErro.slice(0, 10)) {
    console.log(`    ⚠ nº ${n.numero} · ${brl(n.valorServico)} · ${n.situacaoNota} · ${JSON.stringify(n.errosNotaFiscal ?? '')}`);
  }
}

main().catch((e) => morrer(e?.stack || String(e)));
