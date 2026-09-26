#!/usr/bin/env node
// Varredura de sellValue / priceNpc — impede espécies que viram impressora de ouro
// ou impossíveis de capturar por priceNpc absurdo no espelho.
//
//   node tools/auditoria-sell-value.mjs
//
// Sai com código 1 se algo ainda estiver errado DEPOIS da normalização do content.mjs.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { especies, ESTAGIOS_EVOLUTIVOS, nivelDeHuntDaEspecie } from '../src/server/content.mjs';
import { assentarValorDasEspecies } from '../src/shared/valor-cadeia.mjs';
import {
  TETO_PRICE_NPC_VENDA,
  precoVendaPokemon,
  valorEconomicoDe,
  normalizarSellValue,
} from '../src/shared/sell-value.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const creatures = JSON.parse(
  readFileSync(join(raiz, '../public/data/creatures.json'), 'utf8'),
).creatures;

const ok = (msg) => console.log('  ✓', msg);
const falha = (msg) => console.log('  ✗', msg);

let erros = 0;

console.log('\n=== Auditoria sellValue / priceNpc ===\n');

console.log('1) JSON bruto — priceNpc absurdo ou sellValue > teto');
const jsonRuim = [];
for (const c of creatures) {
  const npc = c.priceNpc ?? 0;
  const sell = c.sellValue ?? 0;
  if (npc > TETO_PRICE_NPC_VENDA || sell > TETO_PRICE_NPC_VENDA) {
    jsonRuim.push({
      id: c.pokeId,
      name: c.name,
      huntLevel: c.huntLevel,
      priceNpc: npc,
      sellValue: sell || null,
    });
  }
}
console.log(`   ${jsonRuim.length} espécie(s) com lixo no espelho (esperado — corrigimos no boot)`);
for (const r of jsonRuim.sort((a, b) => (b.priceNpc || 0) - (a.priceNpc || 0))) {
  console.log(
    `     · ${String(r.id).padStart(5)} ${r.name.padEnd(22)} hl=${r.huntLevel ?? '?'} priceNpc=${r.priceNpc} sell=${r.sellValue ?? '—'}`,
  );
}

console.log('\n2) Runtime (content.mjs + normalizarSellValue) — tem de estar limpo');
const runtimeRuim = [];
const vendaAlta = [];
for (const esp of especies.values()) {
  const base = valorEconomicoDe(esp);
  const npc = esp.priceNpc ?? 0;
  const v100 = precoVendaPokemon(esp, { level: 100, quality: 1, shiny: false });
  if (base > TETO_PRICE_NPC_VENDA || npc > TETO_PRICE_NPC_VENDA) {
    runtimeRuim.push({ id: esp.pokeId, name: esp.name, base, priceNpc: npc, v100 });
  }
  if (v100 > TETO_PRICE_NPC_VENDA) {
    vendaAlta.push({ id: esp.pokeId, name: esp.name, v100, base });
  }
}

if (!runtimeRuim.length) ok('nenhuma espécie com base ou priceNpc acima do teto');
else {
  falha(`${runtimeRuim.length} espécie(s) ainda bugadas em runtime`);
  for (const r of runtimeRuim) {
    console.log(`     · ${r.id} ${r.name} base=${r.base} priceNpc=${r.priceNpc} vendaNv100=${r.v100}`);
  }
  erros += runtimeRuim.length;
}

if (!vendaAlta.length) ok('venda ao NPC Nv100 ≤ teto em todas as espécies');
else {
  falha(`${vendaAlta.length} espécie(s) vendem > ${TETO_PRICE_NPC_VENDA.toLocaleString('pt-BR')} no Nv100`);
  for (const r of vendaAlta.sort((a, b) => b.v100 - a.v100)) {
    console.log(`     · ${r.id} ${r.name} vendaNv100=${r.v100.toLocaleString('pt-BR')} base=${r.base}`);
  }
  erros += vendaAlta.length;
}

console.log('\n3) Simulação só no JSON (como era o bug antigo sellValue ?? priceNpc)');
let exploitAntigo = 0;
for (const c of creatures) {
  const antigo = c.sellValue ?? c.priceNpc ?? 0;
  const nv100 = Math.floor(antigo * 3);
  if (nv100 > TETO_PRICE_NPC_VENDA) exploitAntigo++;
}
console.log(`   ${exploitAntigo} espécie(s) dariam venda Nv100 > teto com o fallback antigo`);

console.log('\n4) Cliente — normalizar espécie recém-baixada do JSON');
let clienteRuim = 0;
for (const c of creatures) {
  const clone = { ...c };
  normalizarSellValue(clone);
  if ((clone.sellValue ?? 0) > TETO_PRICE_NPC_VENDA || (clone.priceNpc ?? 0) > TETO_PRICE_NPC_VENDA) {
    clienteRuim++;
    if (clienteRuim <= 10) {
      console.log(`     · ${clone.pokeId} ${clone.name} sell=${clone.sellValue} priceNpc=${clone.priceNpc}`);
    }
  }
}
if (!clienteRuim) ok('todas as espécies ficam saneadas no cliente');
else {
  falha(`${clienteRuim} espécie(s) ainda ruins após normalizar no cliente`);
  erros += clienteRuim;
}

console.log('\n5) Hoenn+ — label do Market tem de bater com a venda (cliente vs servidor)');
const novos = JSON.parse(
  readFileSync(join(raiz, '../game/src/server/dados/creatures-novos.json'), 'utf8'),
).creatures;
const pkTeste = { level: 500, quality: 0.884, shiny: false };
// O cliente normaliza cada espécie do JSON e, no fim, assenta o valor pela hunt e pela cadeia
// (`shared/valor-cadeia.mjs`) — passagem que precisa do catálogo inteiro, não de uma espécie solta.
// A lista é o catálogo do servidor com as Hoenn+ trocadas pelo clone recém-normalizado do JSON.
const clonesCliente = new Map([...especies.values()].map((e) => [e.pokeId, { ...e }]));
for (const c of novos) {
  if ((c.huntLevel ?? 0) <= 150 || !especies.has(c.pokeId)) continue;
  const clone = { ...c };
  normalizarSellValue(clone);
  clonesCliente.set(c.pokeId, clone);
}
assentarValorDasEspecies(clonesCliente.values(), ESTAGIOS_EVOLUTIVOS, nivelDeHuntDaEspecie);
let labelErrado = 0;
for (const c of novos) {
  if ((c.huntLevel ?? 0) <= 150) continue;
  const srv = especies.get(c.pokeId);
  if (!srv) continue;
  const vSrv = precoVendaPokemon(srv, pkTeste);
  const vCli = precoVendaPokemon(clonesCliente.get(c.pokeId), pkTeste);
  if (vSrv !== vCli) {
    labelErrado++;
    if (labelErrado <= 8) {
      console.log(
        `     · ${c.pokeId} ${c.name} hl=${c.huntLevel} srv=${vSrv.toLocaleString('pt-BR')} cli=${vCli.toLocaleString('pt-BR')}`,
      );
    }
  }
}
if (!labelErrado) ok('creatures-novos Hoenn+ — preço exibido = preço pago');
else {
  falha(`${labelErrado} espécie(s) Hoenn+ com label diferente da venda real`);
  erros += labelErrado;
}

console.log(`\n=== ${erros ? 'FALHOU' : 'OK'} — ${erros} problema(s) em runtime ===\n`);
process.exit(erros ? 1 : 0);
