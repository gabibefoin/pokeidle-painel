// As MIGRAÇÕES DE BOOT com dez processos ao mesmo tempo — o que um deploy faz com os sims.
//
// Precisa só do Postgres local (npm run infra). Dispara dez processos filhos no mesmo instante:
//
//   · **sem a trava**, cada um roda o que derrubou o sim 4 e o sim 6 no deploy de 16/09/2026 — o
//     DROP + ADD da chave de `guild_pvp_eventos` — e o `CREATE TABLE IF NOT EXISTS` de uma tabela
//     que ainda não existe. É a CONTRAPROVA: mostra que a corrida é real nesta máquina;
//   · **com a trava** (`db.travarMigracoes`), cada um roda as migrações de verdade (guild,
//     campeonato, chat, auditoria) mais a mesma tabela nova. Nenhum pode falhar, e os intervalos
//     dentro da trava não podem se sobrepor.
//
//   node tools/teste-migracoes-concorrentes.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FILHOS = 10;
const args = process.argv.slice(2);

// ------------------------------------------------------------------ o filho
if (args[0] === '--filho') {
  const [, id, modo, tabela, largada] = args;
  const { pool, travarMigracoes } = await import('../src/server/db.mjs');
  await pool.query('SELECT 1'); // conexão aberta ANTES da largada: a corrida é das migrações
  await new Promise((r) => setTimeout(r, Math.max(0, Number(largada) - Date.now())));
  const saida = { id: Number(id), ok: true, erro: null, dentro: null, fora: null };
  try {
    if (modo === 'sem-trava') {
      await pool.query(`ALTER TABLE guild_pvp_eventos DROP CONSTRAINT IF EXISTS guild_pvp_eventos_vencedor_id_fkey`);
      await pool.query(
        `ALTER TABLE guild_pvp_eventos ADD CONSTRAINT guild_pvp_eventos_vencedor_id_fkey
           FOREIGN KEY (vencedor_id) REFERENCES guilds(id) ON DELETE SET NULL`,
      );
      await pool.query(`CREATE TABLE IF NOT EXISTS ${tabela} (id BIGINT PRIMARY KEY, player_id BIGINT REFERENCES players(id))`);
    } else {
      const soltar = await travarMigracoes(`filho ${id}`);
      saida.dentro = Date.now();
      await (await import('../src/server/guild-db.mjs')).migrar();
      await (await import('../src/server/campeonato-db.mjs')).migrar();
      await (await import('../src/server/chat-db.mjs')).migrar();
      await (await import('../src/server/audit-db.mjs')).migrar();
      await pool.query(`CREATE TABLE IF NOT EXISTS ${tabela} (id BIGINT PRIMARY KEY, player_id BIGINT REFERENCES players(id))`);
      saida.fora = Date.now();
      await soltar();
    }
  } catch (err) {
    saida.ok = false;
    saida.erro = err.message;
  }
  console.log(`RESULTADO ${JSON.stringify(saida)}`);
  await pool.end();
  process.exit(0);
}

// ------------------------------------------------------------------ o pai
let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};

const { pool } = await import('../src/server/db.mjs');
const arquivo = fileURLToPath(import.meta.url);

async function rodada(modo, tabela) {
  await pool.query(`DROP TABLE IF EXISTS ${tabela}`);
  const largada = Date.now() + 2500;
  const filhos = Array.from({ length: FILHOS }, (_, i) => new Promise((resolve) => {
    const proc = spawn(process.execPath, [arquivo, '--filho', String(i), modo, tabela, String(largada)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let texto = '';
    proc.stdout.on('data', (d) => { texto += d; });
    proc.stderr.on('data', (d) => { texto += d; });
    proc.on('close', () => {
      const linha = texto.split('\n').find((l) => l.startsWith('RESULTADO '));
      resolve(linha ? JSON.parse(linha.slice(10)) : { id: i, ok: false, erro: `sem resultado: ${texto.slice(-200)}` });
    });
  }));
  const resultados = await Promise.all(filhos);
  await pool.query(`DROP TABLE IF EXISTS ${tabela}`);
  return resultados;
}

const marca = Date.now().toString(36);

console.log(`MIGRAÇÕES com ${FILHOS} processos ao mesmo tempo\n${'='.repeat(40)}`);

console.log('\nContraprova: sem a trava (o boot como era)');
{
  // A corrida depende do agendador; três rodadas dão chance de sobra para ela aparecer.
  let erros = [];
  for (let r = 0; r < 3 && !erros.length; r++) {
    const res = await rodada('sem-trava', `teste_migracao_${marca}_s${r}`);
    erros = res.filter((x) => !x.ok).map((x) => x.erro);
  }
  ok(erros.length > 0, 'sem a trava, algum processo estoura', 'nenhum estourou em 3 rodadas — a corrida não apareceu nesta máquina');
  if (erros.length) console.log(`    ex.: ${[...new Set(erros)].slice(0, 2).join(' | ')}`);
}

console.log('\nCom a trava de migração');
{
  const res = await rodada('com-trava', `teste_migracao_${marca}_c`);
  const erros = res.filter((x) => !x.ok);
  ok(erros.length === 0, `os ${FILHOS} processos migram sem erro`, erros.map((x) => `#${x.id}: ${x.erro}`).join(' | '));
  const janelas = res.filter((x) => x.dentro != null).sort((a, b) => a.dentro - b.dentro);
  const sobrepostas = janelas.filter((x, i) => i > 0 && x.dentro < janelas[i - 1].fora);
  ok(janelas.length === FILHOS && sobrepostas.length === 0, 'e nenhum migra ao mesmo tempo que outro',
    sobrepostas.map((x) => `#${x.id}`).join(', '));
  const total = janelas.length ? janelas.at(-1).fora - janelas[0].dentro : 0;
  console.log(`    ${FILHOS} migrações em fila: ${(total / 1000).toFixed(1)} s do primeiro ao último`);
  const { rows } = await pool.query(
    `SELECT confdeltype FROM pg_constraint WHERE conname = 'guild_pvp_eventos_vencedor_id_fkey'`,
  );
  ok(rows[0]?.confdeltype === 'n', 'a chave do vencedor da guerra segue ON DELETE SET NULL', JSON.stringify(rows));
  const { rows: trava } = await pool.query(
    `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objsubid = 1
       AND ((classid::bigint << 32) | objid::bigint) = hashtext('pokeidle:migracoes')::bigint`,
  );
  ok(trava[0].n === 0, 'e ninguém ficou segurando a trava no fim', `${trava[0].n} trava(s)`);
}

await pool.end();
console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
