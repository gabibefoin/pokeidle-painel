#!/usr/bin/env node
// Roda a Guerra de Guilds AGORA, fora das 22h UTC — uso dev/ops.
//
// A guerra é um evento diário automático (ver `src/server/game/guild-pvp.mjs`). Este script é
// o mesmo caminho, chamado na mão:
//
//   node tools/guerra-agora.mjs                    a guerra de hoje
//   node tools/guerra-agora.mjs --refazer          apaga o resultado de hoje e roda de novo
//   node tools/guerra-agora.mjs 2026-08-13         um dia específico
//   node tools/guerra-agora.mjs --registrar-todas  inscreve TODA guild com equipe (só dev)
//
// Serve para duas coisas: em desenvolvimento, ter uma batalha gravada para abrir o replay sem
// esperar o horário; em produção, dar segunda chance a um dia que ficou sem resultado porque
// o processo caiu no meio.
//
// **`--refazer` não devolve o GP** já pago da rodada anterior — ver `apagarBatalha`.
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import * as gdb from '../src/server/guild-db.mjs';
import { rodarGuerraAgora } from '../src/server/game/guild-pvp.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const dia = argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? gdb.dataEventoGuild();

await gdb.migrar();

if (flag('registrar-todas')) {
  const { rows } = await pool.query(
    `SELECT DISTINCT gm.guild_id
       FROM guild_members gm
       JOIN player_pokemon pp ON pp.player_id = gm.player_id
      WHERE pp.slot IS NOT NULL AND pp.anuncio_id IS NULL`,
  );
  for (const r of rows) {
    await pool.query(
      `INSERT INTO guild_pvp_registros (guild_id, evento_data) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [r.guild_id, dia],
    );
  }
  console.log(`[guerra] ${rows.length} guild(s) com equipe inscritas em ${dia}`);
}

const inscritas = await gdb.registrosPvpDoDia(dia);
if (!inscritas.length) {
  console.error(
    `[guerra] nenhuma guild registrada em ${dia}.\n` +
      `         Registre pelo jogo (PvP → PvP Guild, só o dono) ou use --registrar-todas.`,
  );
  process.exit(1);
}
console.log(`[guerra] ${dia}: ${inscritas.map((g) => g.nome).join(', ')}`);

try {
  const resumo = await rodarGuerraAgora(dia, { refazer: flag('refazer') });
  if (!resumo) {
    console.log('[guerra] nenhuma guild tinha equipe montada — evento sem batalha');
  } else {
    console.log(
      `[guerra] ${resumo.motivo} · ${(resumo.duracaoMs / 1000).toFixed(1)}s de fita · ` +
        `campeã: ${resumo.vencedor?.nome ?? '—'} (+${resumo.vencedor?.gp ?? 0} GP)`,
    );
    for (const g of resumo.placar) {
      console.log(`         ${g.pos}º ${g.nome} — ${g.abates}⚔ ${g.mortes}☠ +${g.gp} GP`);
    }
    console.log('[guerra] abra o jogo em PvP → PvP Guild → "Assistir ao replay da última batalha"');
  }
} catch (err) {
  console.error(`[guerra] ${err.message}`);
  process.exit(1);
}

// O barramento (Redis) abre conexão sozinho no anúncio do chat e segura o processo de pé.
process.exit(0);
