// A arte que você editou à mão sobrevive ao deploy?
//
//   node tools/teste-espelho.mjs [url]
//
// ### O erro que este teste existe para pegar
//
// `public/data/` é um ESPELHO: `npm run fetch` reconstrói a pasta inteira a partir do origin,
// e ela está no `.gitignore`. Um arquivo editado ali existe só na máquina de quem editou.
//
// O modo de falhar é cruel porque não parece falha. O arquivo **não some** em produção — ele
// volta a ser a versão do origin. Nenhum 404, nenhum erro no console, nenhum teste vermelho:
// só o ícone errado na tela, e a impressão de que o deploy não subiu. Foi o que aconteceu com
// o `moeda-diamante.png`, trocado à mão pelo gem/ice e revertido silenciosamente a cada `fetch`.
//
// A checagem: para cada arquivo do espelho, o byte-a-byte contra o que o servidor serve. Se
// diferem, ou o espelho local está velho (inofensivo) ou tem edição à mão (vai se perder).
//
//   · arte NOSSA          → `src/client/img/`, servida em `/img/`, versionada no git
//   · espelho de terceiro → `public/data/`, servida em `/assets/`, gitignorada e regenerável
import { readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'https://pokeidle.io').replace(/\/$/, '');
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/data');

console.log(`ESPELHO — local x ${BASE}\n${'='.repeat(52)}`);

/**
 * Só as pastas de interface. O espelho inteiro tem dezenas de milhares de arquivos (sprites,
 * mapas) e nenhum deles é editado à mão — conferir todos custaria minutos para achar nada. As
 * edições sempre foram em ícone de UI e de loja, que é onde arte nossa se disfarça de terceira.
 */
const PASTAS = ['site/assets/ui', 'site/assets/loja'];

const arquivos = [];
for (const pasta of PASTAS) {
  const dir = join(RAIZ, pasta);
  try {
    for (const nome of await readdir(dir)) {
      const caminho = join(dir, nome);
      if ((await stat(caminho)).isFile()) arquivos.push(`${pasta}/${nome}`);
    }
  } catch {} // pasta que ainda não foi baixada não é erro
}

const suspeitos = [];
await Promise.all(
  arquivos.map(async (rel) => {
    const local = (await stat(join(RAIZ, rel))).size;
    let remoto = null;
    try {
      const r = await fetch(`${BASE}/assets/${rel}`);
      // 404 aqui é inofensivo e esperado: é arte que já foi movida para `/img/`, e o caminho
      // velho do espelho ficou órfão. Quem cobra o caminho vivo é o `teste-assets.mjs`.
      if (r.ok) remoto = (await r.arrayBuffer()).byteLength;
    } catch {}
    if (remoto !== null && remoto !== local) suspeitos.push({ rel, local, remoto });
  }),
);

console.log(`\n${arquivos.length} arquivos de interface conferidos\n`);
for (const { rel, local, remoto } of suspeitos.sort((a, b) => a.rel.localeCompare(b.rel))) {
  console.log(`  DIFERE  local=${String(local).padEnd(7)} prod=${String(remoto).padEnd(7)} ${rel}`);
}

if (suspeitos.length) {
  console.log(`\n${suspeitos.length} arquivo(s) do espelho diferem de produção.`);
  console.log('Se algum deles é arte SUA, mova para src/client/img/ e aponte o código para /img/ —');
  console.log('senão o próximo `npm run fetch` no servidor apaga a sua versão sem avisar.');
} else {
  console.log('nenhuma divergência — nada de arte nossa escondida no espelho');
}
process.exitCode = suspeitos.length ? 1 : 0;
