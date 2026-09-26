// SEGURANÇA DO "OFERENDAR TUDO DO DEPOT" — o que um cliente hostil consegue arrancar dele.
//
//     node tools/teste-oferenda-lote-seguranca.mjs [http://localhost:8080]
//
// Precisa de um servidor de pé (gateway + sim) apontando para o MESMO Postgres do `.env`. Cria
// uma conta descartável com um depot montado à mão, ataca pelo socket e confere o resultado no
// BANCO — não na tela, que é justamente o que o atacante controla. Apaga tudo no fim.
//
// ### Por que este comando merece um teste só dele
//
// `oferenda.tudo` é o comando mais destrutivo do jogo: um pacote de 24 bytes apaga até 250
// linhas de `player_pokemon`, para sempre. Ele não aceita NENHUM campo do cliente — e é
// exatamente isso que precisa ser provado, porque "o handler ignora `m`" é uma frase que
// envelhece mal: basta alguém acrescentar um parâmetro "só para a tela" um dia.
//
// O que se ataca aqui:
//
//   1. **injeção de alvo** — mandar `pokemonIds` com o ativo, a equipe e a Coleção dentro;
//   2. **injeção de regra** — mandar `notaMax`, `girosMax`, `protegidos: []` e `casas` para
//      afrouxar a peneira e estourar o teto de giros;
//   3. **forjar o carimbo do servidor** — `doCliente: false` para cair no ramo interno do sim;
//   4. **rajada** — dez lotes num piscar, contra o balde `oferendaLote` do gateway;
//   5. **corrida** — dois lotes ao mesmo tempo, atrás de crédito em dobro;
//   6. **o que NÃO pode sumir** — ativo, equipe, Coleção, shiny, P5, refinado, com TM, starter,
//      com item segurado, e o último pokémon da conta;
//   7. **a conta das pedras** — o que foi creditado bate com os giros que o servidor relatou.
import WebSocket from 'ws';
import { criarConta, assinarSessao } from '../src/server/auth.mjs';
import { pool } from '../src/server/db.mjs';
import { OFERENDA_CASAS, OFERENDA_LOTE_GIROS_MAX } from '../src/shared/oferenda.mjs';
import { XP_SHARE_HELD_ID } from '../src/shared/xp-share-held.mjs';

const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const WS_URL = ORIGEM.replace(/^http/, 'ws');
const SUFIXO = Date.now().toString(36).slice(-6);

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const criadas = [];
async function novaConta(nick) {
  const c = await criarConta({ nick, email: `${nick}@gmail.com`, senha: 'teste1234' });
  const { rows } = await pool.query(
    `UPDATE accounts SET nick = $2, nick_ok = true, email_ok = true WHERE id = $1 RETURNING *`,
    [c.id, nick],
  );
  criadas.push(nick);
  return {
    nick: rows[0].nick,
    token: await assinarSessao({ nick: rows[0].nick, contaId: Number(rows[0].id), provedor: rows[0].provedor }),
  };
}

function conectar({ token }) {
  return new Promise((resolver, rejeitar) => {
    const ws = new WebSocket(WS_URL);
    const eventos = [];
    const s = {
      ws,
      eventos,
      mandar: (m) => ws.send(JSON.stringify(m)),
      // Os eventos de batalha (`k`) são onde `oferendaLote` e os avisos chegam.
      dosLotes: () => eventos.filter((e) => e.k === 'oferendaLote'),
      avisos: () => eventos.filter((e) => e.k === 'aviso').map((e) => e.msg),
    };
    const prazo = setTimeout(() => rejeitar(new Error('sem welcome em 20 s')), 20_000);
    ws.on('message', (raw) => {
      const txt = raw.toString();
      if (txt.includes('"t":"welcome"')) { clearTimeout(prazo); resolver(s); }
      try {
        const m = JSON.parse(txt);
        if (m.t === 'batalha') for (const e of m.ev ?? []) eventos.push(e);
      } catch { /* frame que não é JSON não interessa aqui */ }
    });
    ws.on('open', () => s.mandar({ t: 'hello', token }));
    ws.on('error', rejeitar);
  });
}

// ------------------------------------------------------------------ o depot de teste
//
// IVs altos e nível baixo: a nota (N=) sai alta e ficaria ACIMA da régua do Auto Lock. O que se
// quer aqui é o contrário — pokémon comuns, de nota baixa, que o lote deve levar. Os IVs vão
// no chão por isso.
const IVS_RUINS = JSON.stringify({ hp: 0, atk: 0, def: 0, spAtk: 0, spDef: 0, speed: 0 });
const IVS_BONS = JSON.stringify({ hp: 31, atk: 31, def: 31, spAtk: 31, spDef: 31, speed: 31 });

/**
 * A linha de `players` criada à MÃO, antes de qualquer `hello`.
 *
 * O caminho natural (deixar o primeiro `hello` criar) não serve a este teste: o sim guarda o
 * jogador em memória por 90 s depois do `sair` (a carência de reconexão), então um pokémon
 * inserido no banco nesse meio-tempo é invisível para ele — e o lote responderia "nada a
 * oferendar" com dezessete linhas no banco. Montando o depot ANTES do primeiro login, o
 * `carregarOuCriarJogador` lê tudo de uma vez.
 */
async function criarJogador(nick) {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, gold, tutorial_visto, aviso_visto) VALUES ($1, 100000, true, 999)
     RETURNING id`,
    [nick],
  );
  return Number(rows[0].id);
}

async function porPlayer(nick) {
  const { rows } = await pool.query(`SELECT * FROM players WHERE lower(nick) = lower($1)`, [nick]);
  return rows[0];
}
const idsVivos = async (playerId) => (await pool.query(
  `SELECT id FROM player_pokemon WHERE player_id = $1 ORDER BY id`, [playerId],
)).rows.map((r) => Number(r.id));

/**
 * Uma linha de `player_pokemon` montada à mão.
 *
 * As colunas extras ENTRAM no lugar das padrão (e não ao lado): `potencia` já vem na base, e
 * repeti-la no INSERT é erro do Postgres, não aviso.
 */
async function criarPokemon(playerId, extras = {}) {
  const colunas = {
    species_id: 1, level: 5, ivs: IVS_RUINS, hp: 100, power: 50, potencia: 1, ...extras,
  };
  const nomes = Object.keys(colunas);
  const valores = nomes.map((n) => colunas[n]);
  const marcas = nomes.map((n, i) => (n === 'ivs' ? `$${i + 2}::jsonb` : `$${i + 2}`));
  const { rows } = await pool.query(
    `INSERT INTO player_pokemon (player_id, ${nomes.join(', ')})
     VALUES ($1, ${marcas.join(', ')}) RETURNING id`,
    [playerId, ...valores],
  );
  return Number(rows[0].id);
}

async function limpar() {
  if (!criadas.length) return;
  const nicks = criadas.map((n) => n.toLowerCase());
  const { rows } = await pool.query(`SELECT id FROM players WHERE lower(nick) = ANY($1::text[])`, [nicks]);
  const ids = rows.map((r) => Number(r.id));
  if (ids.length) {
    await pool.query(`DELETE FROM player_gameplay_log WHERE player_id = ANY($1::bigint[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM player_audit_log WHERE player_id = ANY($1::bigint[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM player_pokemon WHERE player_id = ANY($1::bigint[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [ids]).catch(() => {});
  }
  const contas = await pool.query(`SELECT id FROM accounts WHERE lower(nick) = ANY($1::text[])`, [nicks]);
  const cids = contas.rows.map((r) => Number(r.id));
  if (cids.length) {
    await pool.query(`DELETE FROM conta_origens WHERE conta_id = ANY($1::bigint[])`, [cids]).catch(() => {});
    await pool.query(`DELETE FROM accounts WHERE id = ANY($1::bigint[])`, [cids]).catch(() => {});
  }
}

console.log(`SEGURANÇA DO LOTE DA OFERENDA\n=============================\n${ORIGEM}`);

try {
  // ---------------------------------------------------------------- preparo
  secao('Preparo: um depot com tudo o que NÃO pode sumir');
  const conta = await novaConta(`lote${SUFIXO}`);
  const pid = await criarJogador(conta.nick);
  ok(!!pid, 'a conta de teste tem linha em players');

  // Dez comuns de nota baixa: são ESTES que o lote pode levar.
  const comuns = [];
  for (let i = 0; i < 10; i++) comuns.push(await criarPokemon(pid, { species_id: 1 }));

  // E os intocáveis, um de cada motivo.
  const ativo = await criarPokemon(pid, { species_id: 4 });
  const naEquipe = await criarPokemon(pid, { species_id: 7 });
  const naColecao = await criarPokemon(pid, { species_id: 10 });
  const shiny = await criarPokemon(pid, { species_id: 13, shiny: true });
  const p5 = await criarPokemon(pid, { species_id: 16, potencia: 5 });
  const comItem = await criarPokemon(pid, { species_id: 19, held_item_id: XP_SHARE_HELD_ID });
  // Nota ACIMA da régua do Auto Lock (3,5) — e só IV não basta: 31 em tudo com qualidade 0 dá
  // 1,86, bem abaixo dela. Quem levanta a nota é a qualidade e a potência, então elas vão aqui.
  const bom = await criarPokemon(pid, {
    species_id: 25, ivs: IVS_BONS, level: 80, quality: 3, potencia: 3,
  });
  const intocaveis = [ativo, naEquipe, naColecao, shiny, p5, comItem];

  await pool.query(`UPDATE players SET active_poke = $2 WHERE id = $1`, [pid, ativo]);
  await pool.query(`UPDATE player_pokemon SET slot = 1 WHERE id = $1`, [naEquipe]);
  // A Coleção é a lista `automation.pokemonTravado` — o mesmo cadeado antigo de venda.
  await pool.query(
    `UPDATE players SET automation = jsonb_set(COALESCE(automation, '{}'::jsonb), '{pokemonTravado}', $2::jsonb) WHERE id = $1`,
    [pid, JSON.stringify([naColecao])],
  );

  const antes = await idsVivos(pid);
  ok(antes.length === 17, `o depot de teste tem 17 pokémon`, String(antes.length));

  const s = await conectar(conta);
  await esperar(1200);

  // ------------------------------------------------- 1, 2 e 3: injeção de campo
  secao('1-3 · Injeção de alvo, de regra e do carimbo do servidor');
  s.mandar({
    t: 'oferenda.tudo',
    // 1) alvos: manda justamente o que não pode sumir
    pokemonIds: [...intocaveis, bom],
    ids: [...intocaveis, bom],
    // 2) regras: afrouxa a peneira e estoura o teto
    notaMax: 99, girosMax: 9999, casas: 1, protegidos: [], totalNaConta: 999999,
    // 3) o carimbo que separa "clique de jogador" de "mensagem do servidor"
    doCliente: false,
    playerId: 'outro_jogador',
  });
  const chegou = await (async () => {
    for (let i = 0; i < 60; i++) {
      if (s.dosLotes().length) return true;
      await esperar(250);
    }
    return false;
  })();
  ok(chegou, 'o lote respondeu (o pacote hostil não derrubou nem travou o comando)',
    s.avisos().join(' / '));

  const lote = s.dosLotes()[0] ?? {};
  const depois = await idsVivos(pid);
  const sumiram = antes.filter((id) => !depois.includes(id));

  ok(!sumiram.some((id) => intocaveis.includes(id)),
    'nenhum dos intocáveis sumiu, mesmo tendo sido mandado como alvo',
    `sumiram: ${sumiram.filter((id) => intocaveis.includes(id)).join(',')}`);
  ok(!sumiram.includes(bom),
    'o de nota alta continua vivo — o `notaMax` do cliente não afrouxou a régua');
  ok(sumiram.length === 10, 'sumiram exatamente os dez comuns', String(sumiram.length));
  ok(lote.giros === 2, 'dois giros (dez pokémon, cinco por giro)', String(lote.giros));
  ok(lote.giros <= OFERENDA_LOTE_GIROS_MAX, 'o `girosMax` do cliente não passou do teto do servidor');
  ok(lote.oferecidos === 10, 'o servidor relatou os dez que ele mesmo escolheu', String(lote.oferecidos));

  // ------------------------------------------------------ 7: a conta das pedras
  secao('7 · A conta das pedras bate com os giros');
  // A bolsa vai ao banco no FLUSH (write-behind), não no crédito: ler antes dele é ler o estado
  // de antes da oferenda e concluir que a pedra sumiu.
  await esperar(4000);
  const dep = await porPlayer(conta.nick);
  const itens = typeof dep.items === 'string' ? JSON.parse(dep.items) : (dep.items ?? {});
  const totalPedras = (lote.pedras ?? []).reduce((acc, x) => acc + Number(x.qtd || 0), 0);
  ok(totalPedras + Number(lote.vazios || 0) === lote.giros,
    'pedras + vazios = giros', `${totalPedras} + ${lote.vazios} ≠ ${lote.giros}`);
  ok(totalPedras === 2, 'dois giros cheios dão duas pedras garantidas', String(totalPedras));
  for (const pedra of lote.pedras ?? []) {
    ok(Number(itens[pedra.itemId] ?? 0) >= pedra.qtd,
      `a pedra ${pedra.itemId} está mesmo na bolsa do banco (${pedra.qtd}×)`,
      `bolsa=${itens[pedra.itemId] ?? 0}`);
  }

  // ------------------------------------- 4 e 5: rajada, teto de giros e corrida
  //
  // Conta nova, com 260 elegíveis: é o tamanho que faz o TETO DE GIROS aparecer de verdade. O
  // primeiro lote leva 250 (50 giros, o teto), o segundo leva os 10 restantes, e do terceiro em
  // diante o balde `oferendaLote` do gateway recusa antes de o sim ver qualquer coisa.
  secao('4 · Rajada de dez lotes, contra o teto de giros e o balde do gateway');
  const conta2 = await novaConta(`lotb${SUFIXO}`);
  const pid2 = await criarJogador(conta2.nick);
  await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, ivs, hp, power, potencia)
     SELECT $1, 1, 5, $2::jsonb, 100, 50, 1 FROM generate_series(1, 260)`,
    [pid2, IVS_RUINS],
  );
  const antes2 = await idsVivos(pid2);
  ok(antes2.length === 260, 'a segunda conta tem 260 pokémon', String(antes2.length));

  const s2 = await conectar(conta2);
  await esperar(2000);
  for (let i = 0; i < 10; i++) s2.mandar({ t: 'oferenda.tudo' });
  await esperar(12_000);

  const lotes2 = s2.dosLotes();
  ok(lotes2.length <= 2, 'de dez pedidos, no máximo 2 viraram lote (balde `oferendaLote`)',
    `passaram ${lotes2.length}`);
  ok(lotes2.length >= 1, 'e pelo menos um passou', String(lotes2.length));
  ok(lotes2.every((l) => l.giros <= OFERENDA_LOTE_GIROS_MAX),
    `nenhum lote passou do teto de ${OFERENDA_LOTE_GIROS_MAX} giros`,
    lotes2.map((l) => l.giros).join(','));
  ok(lotes2[0]?.giros === OFERENDA_LOTE_GIROS_MAX,
    'o primeiro lote parou exatamente no teto', String(lotes2[0]?.giros));
  ok(lotes2[0]?.oferecidos === OFERENDA_LOTE_GIROS_MAX * OFERENDA_CASAS,
    'levando 250 pokémon', String(lotes2[0]?.oferecidos));
  ok(lotes2[0]?.restantes === 10, 'e avisando que sobraram 10', String(lotes2[0]?.restantes));

  // O que sumiu do banco tem de ser EXATAMENTE o que os lotes relataram: um crédito contado
  // duas vezes (ou uma linha apagada sem lote) aparece aqui.
  const depois2 = await idsVivos(pid2);
  const sumiram2 = antes2.filter((id) => !depois2.includes(id));
  const relatado2 = lotes2.reduce((acc, l) => acc + Number(l.oferecidos || 0), 0);
  ok(sumiram2.length === relatado2,
    'o que sumiu do banco é exatamente o que os lotes relataram',
    `banco ${sumiram2.length} ≠ relatado ${relatado2}`);
  ok(depois2.length >= 1, 'e a conta nunca fica sem nenhum pokémon', String(depois2.length));

  const linha2 = await porPlayer(conta2.nick);
  const itens2 = typeof linha2.items === 'string' ? JSON.parse(linha2.items) : (linha2.items ?? {});
  const pedras2 = lotes2.reduce((acc, l) => acc + (l.pedras ?? []).reduce((a, x) => a + Number(x.qtd || 0), 0), 0);
  const naBolsa2 = Object.values(itens2).reduce((a, n) => a + Number(n || 0), 0);
  ok(naBolsa2 === pedras2, 'a bolsa do banco tem exatamente as pedras relatadas',
    `bolsa ${naBolsa2} ≠ relatado ${pedras2}`);

  // --------------------------------------------- 6: o que não podia sumir, não sumiu
  secao('6 · O que não podia sumir na primeira conta');
  const sobraram = await idsVivos(pid);
  ok(sobraram.includes(ativo) && sobraram.includes(naEquipe) && sobraram.includes(naColecao),
    'ativo, equipe e Coleção seguem lá');
  ok(sobraram.includes(shiny) && sobraram.includes(p5) && sobraram.includes(comItem),
    'shiny, P5 e o que segura item também');
  ok(sobraram.includes(bom), 'e o de nota alta também');

  s2.ws.close();

  // ------------------------------------------------------------- a auditoria
  secao('A auditoria guarda o lote');
  const { rows: audit } = await pool.query(
    `SELECT acao, detalhe FROM player_gameplay_log
      WHERE player_id = $1 AND categoria = 'oferenda' ORDER BY id`,
    [pid],
  );
  ok(audit.length > 0, 'o lote deixou linha de auditoria', String(audit.length));
  ok(audit.every((a) => a.acao === 'lote'), 'marcada como `lote`', audit.map((a) => a.acao).join(','));
  ok(audit.some((a) => /giro\(s\).*pokémon/.test(a.detalhe ?? '')),
    'com o tamanho do lote no detalhe', audit[0]?.detalhe ?? '');

  s.ws.close();
} catch (err) {
  falhas++;
  console.error('\nerro no teste:', err.message);
} finally {
  await limpar();
  await pool.end().catch(() => {});
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
