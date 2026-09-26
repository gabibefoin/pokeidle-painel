#!/usr/bin/env node
/**
 * `npm audit` com memória: falha no que é NOVO, cala no que já foi analisado e aceito.
 *
 *   npm run audit
 *
 * ### Por que não chamar o `npm audit` direto no CI
 *
 * Porque ele ficaria vermelho para sempre. A árvore do `@solana/web3.js` arrasta um pacote sem
 * correção publicada, e um verificador que acusa todo dia a mesma coisa que ninguém pode
 * consertar ensina a equipe a ignorar o verificador — e aí o dia em que aparecer uma
 * vulnerabilidade DE VERDADE, ela entra no meio do ruído que todo mundo já aprendeu a pular.
 *
 * Aqui cada exceção é uma linha com nome, motivo e DATA DE REVISÃO. Passou da data, o build
 * falha pedindo uma nova olhada — que é diferente de aceitar para sempre. O padrão continua
 * sendo falhar: só não falha no que está escrito abaixo, com justificativa.
 */
import { spawnSync } from 'node:child_process';

/**
 * O que já foi analisado e aceito, e até quando.
 *
 * Para acrescentar uma linha aqui é preciso responder três coisas: o código é ALCANÇÁVEL pelo
 * nosso uso? existe correção publicada? o que acontece se for explorado? Se a resposta da
 * primeira for "não", diga COMO se verificou — "achei que não" não conta.
 */
const ACEITAS = {
  'GHSA-528h-pc64-c93x': {
    pacote: 'stream-json',
    ate: '2026-12-31',
    motivo: [
      'NÃO É CARREGADO. O `@solana/web3.js` importa `jayson/lib/client/browser`, que puxa só',
      '`uuid` e `generateRequest`. O `stream-json` mora em `jayson/lib/utils.js`, usado pelo',
      'SERVIDOR jayson (parsing de requisições JSON-RPC que chegam) — e nós não rodamos servidor',
      'jayson nenhum. Verificado empiricamente: depois de importar web3.js e spl-token, nem',
      '`stream-json` nem `jayson/lib/utils.js` aparecem no `require.cache`.',
      '',
      'Não tem correção em 1.x (o conserto saiu no 3.x). Já se tentou forçar 3.6.0 por',
      '`overrides`: funciona na árvore, mas reescreve o package-lock de um jeito que o npm do',
      'servidor recusa no `npm ci`, e o deploy morre. Trocar um deploy quebrado por uma',
      'vulnerabilidade que não é sequer carregada é péssimo negócio.',
      '',
      'Rever quando: o jayson soltar versão com stream-json 3.x.',
    ].join(' '),
  },
  'GHSA-w5hq-g745-h8pq': {
    pacote: 'uuid',
    ate: '2026-12-31',
    motivo: [
      'NÃO SE APLICA ao nosso uso. O aviso é sobre `v3`, `v5` e `v6` quando se passa um buffer',
      'de saída (`buf`). O jayson chama `require("uuid").v4` — outra versão do algoritmo, e sem',
      'argumento nenhum (ver `jayson/lib/generateRequest.js` e `client/browser/index.js`).',
      '',
      'Mesma história do stream-json acima quanto ao `overrides`: sobe para o uuid 14 sem',
      'quebrar a árvore, mas o lock resultante derruba o `npm ci` do servidor.',
      '',
      'Rever quando: o jayson subir a faixa do uuid.',
    ].join(' '),
  },
  'GHSA-3gc7-fjrx-p6mg': {
    pacote: 'bigint-buffer',
    ate: '2026-12-31',
    motivo: [
      'Sem correção publicada: 1.1.5 é a última versão e o projeto está sem manutenção. O',
      '`npm audit fix --force` "resolve" rebaixando @solana/spl-token para 0.1.8, que é anterior',
      'ao token-2022 e quebraria o saque de USDT — trocar uma leitura fora de faixa por um bug',
      'no caminho do dinheiro é péssimo negócio.',
      '',
      'Alcançável, mas não disparável pelo nosso uso: o único caminho é',
      '`@solana/buffer-layout-utils`, que chama `toBigIntLE` sempre com buffer de tamanho FIXO',
      '(blob de 8/16/24/32 bytes vindo do layout), e o estouro depende de comprimento',
      'inesperado. Os dados vêm do nosso RPC, por HTTPS.',
      '',
      'Rever quando: o spl-token soltar versão sem buffer-layout-utils, ou aparecer fork',
      'mantido do bigint-buffer.',
    ].join(' '),
  },
};

const hoje = new Date().toISOString().slice(0, 10);

const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 32 * 1024 * 1024,
});
// `npm audit` sai com código != 0 quando ACHA algo — é o caso normal aqui, não um erro.
if (!r.stdout) {
  console.error('npm audit não devolveu nada:', r.stderr?.trim() || `código ${r.status}`);
  process.exit(2);
}

let relatorio;
try {
  relatorio = JSON.parse(r.stdout);
} catch {
  console.error('não consegui ler a saída do npm audit como JSON:\n', r.stdout.slice(0, 2000));
  process.exit(2);
}

/** Um GHSA pode aparecer em vários pacotes da cadeia; o que importa é o conjunto de avisos. */
const avisos = new Map();
for (const vuln of Object.values(relatorio.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== 'object' || !via.url) continue;
    const id = via.url.split('/').pop();
    if (!avisos.has(id)) {
      avisos.set(id, { id, titulo: via.title, severidade: via.severity, pacotes: new Set() });
    }
    avisos.get(id).pacotes.add(via.name ?? vuln.name);
  }
}

const novas = [];
const aceitas = [];
const vencidas = [];

for (const aviso of avisos.values()) {
  const ok = ACEITAS[aviso.id];
  if (!ok) novas.push(aviso);
  else if (ok.ate < hoje) vencidas.push({ ...aviso, ...ok });
  else aceitas.push({ ...aviso, ...ok });
}

const m = relatorio.metadata?.vulnerabilities ?? {};
console.log(`\nnpm audit — ${avisos.size} aviso(s) distinto(s) `
  + `(crítico ${m.critical ?? 0} · alto ${m.high ?? 0} · moderado ${m.moderate ?? 0} · baixo ${m.low ?? 0})\n`);

for (const a of aceitas) {
  console.log(`  [aceita até ${a.ate}] ${a.id} · ${a.pacote} · ${a.severidade}`);
  console.log(`      ${a.titulo}`);
}

for (const a of vencidas) {
  console.log(`\n  [REVISÃO VENCIDA em ${a.ate}] ${a.id} · ${a.pacote}`);
  console.log('      A exceção passou da validade. Confira se já existe correção e renove a data');
  console.log('      (ou tire a linha) em tools/auditar-dependencias.mjs.');
}

for (const a of novas) {
  console.log(`\n  [NOVA] ${a.id} · ${a.severidade} · ${[...a.pacotes].join(', ')}`);
  console.log(`      ${a.titulo}`);
  console.log(`      https://github.com/advisories/${a.id}`);
}

const falhou = novas.length + vencidas.length;
if (!falhou) {
  console.log(`\nNenhum aviso novo.${aceitas.length ? ` ${aceitas.length} exceção(ões) documentada(s).` : ''}\n`);
  process.exit(0);
}
console.log(`\n${novas.length} nova(s) e ${vencidas.length} vencida(s). Corrija, ou documente em`
  + ' tools/auditar-dependencias.mjs com motivo e data de revisão.\n');
process.exit(1);
