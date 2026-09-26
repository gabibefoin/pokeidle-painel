// Teste dos RADARES do Discord — as quatro consultas, os cursores e o texto que vai ao canal.
//
// O que ele protege:
//
//   · **o "sem histórico"**: recém-semeado, o radar não enxerga NADA do que já estava no banco.
//     É o requisito do pedido, e é o que impede o primeiro boot de despejar os 258 shinies e os
//     134 saques da vida do servidor em rajada no canal;
//   · **as quatro consultas**: cada evento novo aparece no feed dele, uma vez só, com o nick
//     resolvido pelo JOIN em `players`;
//   · **o cursor**: depois de anunciado, o mesmo evento não volta na passagem seguinte;
//   · **a fileira de selos do shiny**: potência, IV somado, qualidade e NOTA, na ordem e com as
//     casas decimais do card do jogo — e a nota saindo da mesma `notaDePokemon` que o cliente
//     usa, senão o canal e a ficha diriam números diferentes do mesmo bicho;
//   · **a menção**: a única mensagem que menciona alguém é a do pedido de saque, e o que ela
//     libera é o CARGO e mais nada. Um nick com `@everyone` dentro não pode tocar o servidor;
//   · **o markdown do nick**: `**`, crase e `_` no nick não podem quebrar a frase.
//
// Precisa de Postgres (o do `docker compose up -d`). Apaga tudo o que criou, mesmo se falhar.
//
//   node tools/teste-radar.mjs            [--mostrar]
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import * as radardb from '../src/server/radar-db.mjs';
import {
  mensagemDeposito, mensagemSaqueAprovado, mensagemSaquePedido, mensagemShiny,
  selosDoShiny, shinyVelhoDemais,
} from '../src/bot/radar.mjs';
import { especies } from '../src/server/content.mjs';
import { notaDePokemon } from '../src/shared/nota-pokemon.mjs';
import { normalizarRefino } from '../src/shared/refino-stats.mjs';
import { randomUUID } from 'node:crypto';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

// O que o teste criou, para o `finally` desfazer.
const lixo = { pokeIds: [], saqueIds: [], depositoIds: [] };
let cursoresAntes = [];

/** Um shiny de teste em `player_pokemon`, com os números que a fileira de selos vai mostrar. */
async function criarShiny(playerId, { speciesId = 9, quality = 1.542, potencia = 3, ivs } = {}) {
  const iv = ivs ?? { hp: 22, atk: 20, def: 20, spAtk: 20, spDef: 20, speed: 20 };
  const { rows } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, xp, quality, ivs, hp, shiny, slot, power, potencia, starter)
     VALUES ($1, $2, 80, 0, $3, $4, 100, true, NULL, 0, $5, false) RETURNING id`,
    [playerId, speciesId, quality, JSON.stringify(iv), potencia],
  );
  lixo.pokeIds.push(rows[0].id);
  return rows[0].id;
}

try {
  await radardb.migrar();
  ok(true, 'migrar() criou (ou já tinha) a radar_cursor');

  // Guarda os cursores de verdade: o teste mexe neles e tem de devolvê-los como estavam, senão
  // um `npm run test:radar` na máquina de quem roda o bot faria o radar reanunciar (ou pular)
  // o que aconteceu enquanto o teste rodava.
  cursoresAntes = (await pool.query(`SELECT feed, valor FROM radar_cursor`)).rows;

  const { rows: pl } = await pool.query(`SELECT id, nick FROM players ORDER BY id LIMIT 1`);
  if (!pl.length) throw new Error('nenhum jogador no banco local — restaure um dump antes');
  const jogador = pl[0];

  // ------------------------------------------------------------------ semeadura
  secao('A semeadura (o "sem histórico")');
  await pool.query(`DELETE FROM radar_cursor`);
  const semeados = await radardb.semearCursores();
  ok(semeados.length === 4, 'semeou os quatro feeds', `semeou ${semeados.join(', ')}`);

  const vazio = async (nome, f) => {
    const linhas = await f(await radardb.lerCursor(nome));
    ok(linhas.length === 0, `${nome}: nada de histórico logo após semear`, `veio ${linhas.length}`);
  };
  await vazio('shiny_pk', (c) => radardb.novosShinys(c));
  await vazio('saque_pedido', (c) => radardb.novosSaques(c));
  await vazio('saque_aprovado', (c) => radardb.saquesAprovados(c));
  await vazio('deposito', (c) => radardb.novosDepositos(c));

  const segundaVez = await radardb.semearCursores();
  ok(segundaVez.length === 0, 'semear de novo não mexe em cursor que já existe');

  // O cursor do feed que mudou de fonte (era `shiny`, virou `shiny_pk`) tem de ser varrido: o
  // número dele era um id de outra tabela, e herdá-lo despejaria meio jogo no canal.
  await pool.query(`INSERT INTO radar_cursor (feed, valor) VALUES ('shiny', '1')`);
  await radardb.migrar();
  const { rows: sobrou } = await pool.query(`SELECT 1 FROM radar_cursor WHERE feed = 'shiny'`);
  ok(sobrou.length === 0, 'migrar() apaga cursor de feed que não existe mais');

  // ------------------------------------------------------------------ shiny
  secao('Radar shiny');
  const cursorShiny = await radardb.lerCursor('shiny_pk');
  const shinyId = await criarShiny(jogador.id);

  let linhas = await radardb.novosShinys(cursorShiny);
  ok(linhas.length === 1, 'o shiny novo aparece', `veio ${linhas.length}`);
  ok(String(linhas[0]?.id) === String(shinyId), 'e é o que acabou de nascer');
  ok(linhas[0]?.nick === jogador.nick, 'com o nick vindo do JOIN em players');

  // Um pokémon comum no mesmo intervalo não pode entrar no radar de SHINY.
  const { rows: comum } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, xp, quality, ivs, hp, shiny, slot, power, potencia, starter)
     VALUES ($1, 9, 80, 0, 1.2, $2, 100, false, NULL, 0, 1, false) RETURNING id`,
    [jogador.id, JSON.stringify({ hp: 10, atk: 10, def: 10, spAtk: 10, spDef: 10, speed: 10 })],
  );
  lixo.pokeIds.push(comum[0].id);
  linhas = await radardb.novosShinys(cursorShiny);
  ok(linhas.length === 1, 'um pokémon comum nascido junto não entra no feed');

  await radardb.gravarCursor('shiny_pk', linhas[0].id);
  ok((await radardb.novosShinys(await radardb.lerCursor('shiny_pk'))).length === 0,
    'depois do cursor, o mesmo shiny não volta');

  // ------------------------------------------------------------------ os selos
  secao('A fileira P · IV · Q · N');
  const s = selosDoShiny(linhas[0]);
  ok(s.nome === 'Blastoise', 'a espécie sai do catálogo do jogo', s.nome);
  ok(s.selos[0] === 'P3', 'potência em primeiro', s.selos[0]);
  ok(s.selos[1] === 'IV 122', 'IV SOMADO em segundo', s.selos[1]);
  ok(s.selos[2] === 'Q 1,542', 'qualidade com três casas e vírgula', s.selos[2]);
  ok(/^N \d+,\d{3}$/.test(s.selos[3] ?? ''), 'nota com três casas e vírgula', s.selos[3]);

  const nota = Number((s.selos[3] ?? '').slice(2).replace(',', '.'));
  ok(nota > 0 && nota <= 10, 'e a nota cai na escala de 0 a 10', String(nota));

  // A nota não é um número decorativo: ela tem de RESPONDER aos atributos. Dois bichos da mesma
  // espécie, um com potência e IV de topo e outro com o mínimo, não podem tirar a mesma nota.
  const melhor = selosDoShiny({
    species_id: 9, potencia: 5, quality: 2.0, bonus_base: {},
    ivs: { hp: 32, atk: 32, def: 32, spAtk: 32, spDef: 32, speed: 32 },
  });
  const pior = selosDoShiny({
    species_id: 9, potencia: 1, quality: 1.0, bonus_base: {},
    ivs: { hp: 1, atk: 1, def: 1, spAtk: 1, spDef: 1, speed: 1 },
  });
  const valor = (sel) => Number((sel.selos.find((x) => x.startsWith('N ')) ?? 'N 0').slice(2).replace(',', '.'));
  ok(valor(melhor) > valor(pior), 'P5 com IV 192 tira nota MAIOR que P1 com IV 6',
    `${valor(melhor)} vs ${valor(pior)}`);
  ok(melhor.selos[1] === 'IV 192' && pior.selos[1] === 'IV 6', 'e o IV somado acompanha');

  // O QUE ESTE TESTE EXISTE PARA PEGAR: o radar montando o objeto do pokémon com os campos
  // errados. `notaDePokemon` aceita `quality` e `qualidade`, `ivs` e `iv`, e ignora em silêncio
  // o que não reconhece — trocar `bonus_base` por `refino` no lugar errado não dá erro nenhum,
  // só uma nota diferente da que o jogador vê na ficha.
  //
  // Então a conferência é contra a MESMA montagem que o `montarPokemon` (sim.mjs) faz, sobre um
  // shiny de verdade do banco. Se as duas baterem, o `N=` do canal é o `N=` do card.
  const { rows: reais } = await pool.query(
    `SELECT pp.species_id, pp.quality, pp.ivs, pp.potencia, pp.bonus_base
       FROM player_pokemon pp
      WHERE pp.shiny AND pp.id <> ALL($1::bigint[])
      ORDER BY pp.id DESC LIMIT 5`,
    [lixo.pokeIds],
  );
  let conferidos = 0;
  for (const r of reais) {
    const esp = especies.get(Number(r.species_id));
    if (!esp) continue;
    const ivs = typeof r.ivs === 'string' ? JSON.parse(r.ivs) : r.ivs;
    const esperada = notaDePokemon(
      { ivs, quality: r.quality, potencia: Number(r.potencia) || 1, shiny: true,
        refino: normalizarRefino(r.bonus_base) },
      esp,
    );
    const doRadar = Number((selosDoShiny(r).selos.find((x) => x.startsWith('N ')) ?? '')
      .slice(2).replace(',', '.'));
    if (Math.abs(doRadar - Number(esperada)) > 0.0005) {
      ok(false, 'a nota do radar bate com a do jogo', `${doRadar} vs ${esperada} (esp ${r.species_id})`);
      conferidos = -1;
      break;
    }
    conferidos++;
  }
  ok(conferidos > 0, `a nota do radar bate com a do jogo em ${Math.max(0, conferidos)} shiny(s) reais`);

  const desconhecida = selosDoShiny({
    species_id: 999999, potencia: 2, quality: 1.3, bonus_base: {},
    ivs: { hp: 10, atk: 10, def: 10, spAtk: 10, spDef: 10, speed: 10 },
  });
  ok(desconhecida.nome === '#999999', 'espécie fora do catálogo vira o id, e não "undefined"');
  ok(!desconhecida.selos.some((x) => x.startsWith('N ')),
    'e sem espécie a nota some em vez de virar um "N —"');

  // ------------------------------------------------------------------ saques
  secao('Radar de saques');
  const saqueId = randomUUID();
  lixo.saqueIds.push(saqueId);
  await pool.query(
    `INSERT INTO orb_saques (id, player_id, orbs, usdt, rede, endereco, status)
     VALUES ($1, $2, 1029, 9.261, 'solana', 'EnderecoDeTeste', 'aguardando')`,
    [saqueId, jogador.id],
  );

  const saques = await radardb.novosSaques(await radardb.lerCursor('saque_pedido'));
  ok(saques.length === 1, 'o pedido de saque aparece no feed da staff', `veio ${saques.length}`);
  ok(saques[0]?.nick === jogador.nick, 'com o nick vindo do JOIN em players');
  ok(saques[0]?.status === 'aguardando', 'e com o status atual na linha');

  ok((await radardb.saquesAprovados(await radardb.lerCursor('saque_aprovado'))).length === 0,
    'saque pedido e não aprovado NÃO sai no canal público');

  await radardb.gravarCursor('saque_pedido', saques[0].criado_em);
  ok((await radardb.novosSaques(await radardb.lerCursor('saque_pedido'))).length === 0,
    'depois do cursor, o pedido não volta');

  await pool.query(
    `UPDATE orb_saques SET status = 'pendente', aprovado_por = 'teste@pokeidle.io', aprovado_em = now()
      WHERE id = $1`,
    [saqueId],
  );
  const aprovados = await radardb.saquesAprovados(await radardb.lerCursor('saque_aprovado'));
  ok(aprovados.length === 1, 'aprovado, ele entra no feed público', `veio ${aprovados.length}`);
  ok(aprovados[0]?.aprovado_por === undefined, 'e o e-mail do admin NÃO vem na consulta');

  await radardb.gravarCursor('saque_aprovado', aprovados[0].aprovado_em);
  ok((await radardb.saquesAprovados(await radardb.lerCursor('saque_aprovado'))).length === 0,
    'depois do cursor, a aprovação não volta');

  // ------------------------------------------------------------------ depósitos
  secao('Radar de depósitos');
  const { rows: dep } = await pool.query(
    `INSERT INTO orb_depositos (player_id, rede, tx_hash, de_endereco, usdt, orbs, referencia)
     VALUES ($1, 'solana', $2, 'CarteiraDeTeste', 20, 2000, 'teste-radar') RETURNING id`,
    [jogador.id, `teste-${randomUUID()}`],
  );
  lixo.depositoIds.push(dep[0].id);

  const depositos = await radardb.novosDepositos(await radardb.lerCursor('deposito'));
  ok(depositos.length === 1, 'o depósito novo aparece', `veio ${depositos.length}`);
  ok(Number(depositos[0]?.orbs) === 2000 && Number(depositos[0]?.usdt) === 20,
    'com as duas pontas: dólar que entrou e gema que saiu');

  await radardb.gravarCursor('deposito', depositos[0].id);
  ok((await radardb.novosDepositos(await radardb.lerCursor('deposito'))).length === 0,
    'depois do cursor, o depósito não volta');

  // ------------------------------------------------------------------ o corte de frescor
  secao('Shiny velho demais (o bot voltando de um fim de semana parado)');
  const agora = Date.now();
  ok(shinyVelhoDemais({ caught_at: new Date(agora - 3 * 3600_000).toISOString() }, agora),
    'captura de três horas atrás é velha demais para o canal');
  ok(!shinyVelhoDemais({ caught_at: new Date(agora - 90_000).toISOString() }, agora),
    'captura de um minuto e meio atrás entra');
  ok(!shinyVelhoDemais({ caught_at: new Date(agora - 59 * 60_000).toISOString() }, agora),
    'e a borda de 59 minutos ainda entra');

  // ------------------------------------------------------------------ as mensagens
  //
  // Os montadores são funções puras: a linha do banco entra, o corpo do POST sai. Dá para
  // conferir o texto inteiro — e o `allowed_mentions`, que é a parte que não pode errar — sem
  // falar com o Discord uma vez sequer.
  secao('As mensagens que vão ao Discord');

  const mShiny = mensagemShiny({ ...linhas[0], nick: 'RadarTeste' });
  ok(mShiny.content.includes('**Blastoise**') && mShiny.content.includes('**RadarTeste**'),
    'a do shiny traz o nick e a espécie', mShiny.content);
  ok(mShiny.content.includes('P3 · IV 122 · Q 1,542 · N '),
    'com a fileira de selos no rodapé, na ordem do card', mShiny.content);
  ok(!/\bNv\b/.test(mShiny.content), 'e SEM o nível — foi pedido para tirar');

  const mP5 = mensagemShiny({ ...linhas[0], nick: 'RadarTeste', potencia: 5 });
  ok(mP5.content.includes('shiny P5'), 'shiny P5 ganha frase própria', mP5.content);

  const CARGO = '1545485031701610497';
  const mPedido = mensagemSaquePedido(
    { id: saqueId, nick: jogador.nick, orbs: '1029', usdt: '9.261', rede: 'solana',
      status: 'aguardando', criado_em: new Date().toISOString() },
    CARGO,
  );
  ok(mPedido.content.startsWith(`<@&${CARGO}>`), 'o pedido de saque começa mencionando o cargo');
  ok(mPedido.allowed_mentions?.roles?.[0] === CARGO
    && mPedido.allowed_mentions.parse.length === 0,
    'e o allowed_mentions libera SÓ esse cargo');
  ok(mPedido.content.includes('1.029 gemas') && mPedido.content.includes('US$ 9,26'),
    'com gema e dólar formatados em pt-BR', mPedido.content);
  ok(!mPedido.content.includes('EnderecoDeTeste'), 'e sem o endereço da carteira');

  const mAprovado = mensagemSaqueAprovado(
    { nick: jogador.nick, orbs: '1029', usdt: '9.261', rede: 'solana' },
  );
  ok(mAprovado.content.includes('1.029 gemas') && mAprovado.content.includes('US$ 9,26'),
    'a do saque aprovado traz as duas quantias', mAprovado.content);
  ok(!('allowed_mentions' in mAprovado) || !mAprovado.allowed_mentions?.roles?.length,
    'e NÃO menciona cargo nenhum (é canal público)');

  const mDeposito = mensagemDeposito(
    { nick: jogador.nick, orbs: '2000', usdt: '20', rede: 'solana' },
  );
  ok(mDeposito.content.includes('US$ 20,00') && mDeposito.content.includes('2.000 gemas'),
    'a do depósito traz o dólar que entrou e a gema que saiu', mDeposito.content);

  // O pior caso do nick: ele vem do JOGADOR, e o Discord lê markdown em qualquer lugar.
  const hostil = '@everyone **grande** `cod`';
  const mHostil = mensagemSaqueAprovado({ nick: hostil, orbs: '1', usdt: '0.009', rede: 'solana' });
  ok(!mHostil.content.includes('**grande**'), 'nick com ** não fecha o negrito da frase', mHostil.content);
  ok(!/(^|[^\\])`cod`/.test(mHostil.content), 'nick com crase não abre bloco de código');
  ok(mHostil.content.includes('@everyone'), 'o "@everyone" continua VISÍVEL no texto…');
  ok(!mHostil.allowed_mentions?.roles?.length, '…e continua inofensivo: nada de cargo liberado');
  ok(mHostil.content.includes('1 gema') && !mHostil.content.includes('1 gemas'),
    'uma gema no singular');

  if (process.argv.includes('--mostrar')) {
    console.log('\n  --- como cada uma sai no canal ---');
    for (const m of [mShiny, mP5, mPedido, mAprovado, mDeposito]) {
      console.log(`\n${m.content.split('\n').map((l) => `    ${l}`).join('\n')}`);
    }
    console.log('');
  }
} finally {
  // ------------------------------------------------------------------ limpeza
  if (lixo.pokeIds.length) {
    await pool.query(`DELETE FROM player_pokemon WHERE id = ANY($1::bigint[])`, [lixo.pokeIds]);
  }
  if (lixo.saqueIds.length) {
    await pool.query(`DELETE FROM orb_saques WHERE id = ANY($1::text[])`, [lixo.saqueIds]);
  }
  if (lixo.depositoIds.length) {
    await pool.query(`DELETE FROM orb_depositos WHERE id = ANY($1::bigint[])`, [lixo.depositoIds]);
  }
  // Os cursores voltam ao que eram antes do teste.
  await pool.query(`DELETE FROM radar_cursor`);
  for (const c of cursoresAntes) await radardb.gravarCursor(c.feed, c.valor);

  console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
  await pool.end();
  process.exit(falhas ? 1 : 0);
}
