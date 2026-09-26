#!/usr/bin/env node
// Gera `src/client/patch-notes.mjs` a partir dos commits de versão (vX.Y.Z — …).
// O modal ! mostra só versão + título do commit (sem bullets — menos info exposta).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = execSync('git log --format="===COMMIT===%n%s%n%b" --grep="^v[0-9]"', {
  cwd: raiz,
  encoding: 'utf8',
});

const TAG_GAMEPLAY = /^\[GAMEPLAY\]\s*/i;

/** Título com cara de admin/dev puro — some da lista do jogador. */
function ehDevOuAdmin(texto) {
  const t = texto.trim();
  if (!t) return true;
  const l = t.toLowerCase();

  if (/\.(mjs|jsx?|tsx?|css|json|md|py|html|ps1|sh|yml|sql)\b/.test(l)) return true;
  if (/\b(tools\/|src\/|game\/|npm run|deploy\.|teste-|test:|painel admin|\/admin\b|tesouraria admin|auditoria admin|custos e ganhos|enviar emails|caixa de entrada|unifica chave|chavepokedex|painel de lucro)\b/.test(l)) return true;
  if (/^admin\b/i.test(t) && !/\b(jogador|chat|market|mercado|hunt|boss|guild|pokémon|pokemon|mobile|casa|shiny|pvp)\b/i.test(l)) return true;

  return false;
}

function limparTitulo(titulo) {
  return titulo
    .replace(/\?/g, '—')
    .replace(/\s*[,;]\s*(?:e\s+)?(?:tesouraria|painel|aba)?\s*admin[^,;]*/gi, '')
    .replace(/\s+e\s+(?:tesouraria|painel)\s+admin\b.*$/i, '')
    .replace(/\s+e\s+admin\b.*$/i, '')
    .replace(/\s+e\s+tool\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Commit tem pelo menos um bullet [GAMEPLAY] no corpo. */
function temGameplayNoCorpo(corpo) {
  for (const ln of corpo.split('\n')) {
    const t = ln.trim();
    if (t.startsWith('- ') && TAG_GAMEPLAY.test(t.slice(2))) return true;
  }
  return false;
}

const blocos = raw.split('===COMMIT===\n').filter(Boolean);
const notas = [];

for (const bloco of blocos) {
  const linhas = bloco.trim().split('\n');
  const assunto = linhas[0]?.trim() ?? '';
  const m = assunto.match(/^v(\d+\.\d+\.\d+)\s*[—\-:?]\s*(.+)$/);
  if (!m) continue;

  const [, versao, tituloBruto] = m;
  const titulo = limparTitulo(tituloBruto);
  const corpo = linhas.slice(1).join('\n').trim();

  if (!titulo) continue;
  if (ehDevOuAdmin(titulo) && !temGameplayNoCorpo(corpo)) continue;

  notas.push({ versao, titulo });
}

const saida = join(raiz, 'src/client/patch-notes.mjs');
const conteudo = `// Gerado por tools/gerar-patch-notes.mjs — não editar à mão.
// Rode: npm run patch-notes

/** Patch notes oficiais, do commit de versão mais recente ao mais antigo (só título). */
export const PATCH_NOTES = ${JSON.stringify(notas, null, 2)};
`;

writeFileSync(saida, conteudo, 'utf8');
console.log(`[patch-notes] ${notas.length} versões (título only) → ${saida}`);
