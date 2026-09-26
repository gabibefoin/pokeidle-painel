// A OFERENDA sob ATAQUE — pacotes forjados contra o servidor no ar.
//
// `teste-oferenda.mjs` prova a roleta sem infra, e `teste-oferenda-ui.mjs` prova a tela com um
// giro honesto. Este aqui é o do cliente adulterado: fala direto com o socket, manda o que a
// tela nunca manda, e confere no BANCO que nenhum caminho paga duas vezes pelo mesmo pokémon.
//
//   · **o mesmo pokémon repetido** numa oferenda só;
//   · **a rajada**: o mesmo giro seis vezes no mesmo instante;
//   · **a corrida com a venda**: queimar e vender ao NPC (um e o lote inteiro) ao mesmo tempo;
//   · **a corrida com o Mercado**: queimar e anunciar ao mesmo tempo, e queimar o que já está
//     à venda — inclusive o SHINY anunciado, antes e depois de relogar, e anunciado por outro
//     processo sem este saber;
//   · **o que está preso**: quem segura Exp. Share e quem está no posto de XP Share de uma Casa;
//   · **queimar e tirar**: mandar o pokémon para a equipe e ativá-lo no meio do giro;
//   · **a memória velha**: a linha mudou de dono (ou sumiu) no banco com o jogador on-line —
//     o que outro processo faria —, e o giro tem de voltar inteiro, sem pedra;
//   · **o pacote inflado**: mais de cinco ids, lixo no lugar deles, e campos de resultado
//     (`indice`, `itemId`, `fatias`) que o servidor tem de ignorar.
//
// Cada cenário usa uma conta própria: o balde de `oferenda.girar` é por conta (6 de uma vez,
// um a cada 4 s), e dividir as rajadas entre contas é o que deixa o teste medir a FILA de
// economia, e não o limitador. As contas nascem direto no banco e são apagadas no fim.
//
// Precisa do servidor de pé:
//
//   npm start
//   node tools/teste-oferenda-ataques.mjs
import { WebSocket } from 'ws';
import { sessaoDe } from './sessao-local.mjs';
import { helloCom } from './auth-teste.mjs';
import { pool, carregarOuCriarJogador } from '../src/server/db.mjs';
import { criarMescladorDeEstado } from '../src/shared/estado-delta.mjs';
import { especies, xpTotalParaNivel } from '../src/server/content.mjs';
import { OFERENDA_CASAS } from '../src/shared/oferenda.mjs';
import { XP_SHARE_HELD_ID } from '../src/shared/xp-share-held.mjs';

const URL = process.env.WS_URL ?? 'ws://localhost:8080';
const MARCA = Date.now().toString(36).slice(-5);
const IVS = { hp: 24, atk: 24, def: 24, spAtk: 24, spDef: 24, speed: 24 };

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ banco

const especiePorNome = (nome) => [...especies.values()].find((e) => e.name.toLowerCase() === nome.toLowerCase());
const CHARMANDER = especiePorNome('Charmander');
const GENGAR = especiePorNome('Gengar');
const PIKACHU = especiePorNome('Pikachu');
const criadas = [];

async function inserirPokemon(playerId, esp, { slot = null, potencia = 1, level = 100, shiny = false, held = null } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia, slot, held_item_id)
     VALUES ($1, $2, $3, 1.2, $4::jsonb, 9999, $7, $5, $6, $8) RETURNING id`,
    [playerId, esp.pokeId, level, JSON.stringify(IVS), potencia, slot, shiny, held],
  );
  return Number(rows[0].id);
}

/** Conta pronta para jogar: o ativo na equipe, `depot` Charmander comuns e `p5` Charmander P5. */
async function criarConta(sufixo, { depot = 12, p5 = 0 } = {}) {
  const nick = `atk${MARCA}${sufixo}`;
  criadas.push(nick);
  await pool.query(
    `INSERT INTO accounts (nick, email, provedor, email_ok) VALUES ($1, $2, 'local', true)`,
    [nick, `${nick}@test.local`],
  );
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp, gold, visual_ok, tutorial_visto, discord_pop_campanha, aviso_visto)
     VALUES ($1, 150, $2, 10000000, true, true, 99, 99) RETURNING id`,
    [nick, xpTotalParaNivel(150)],
  );
  const playerId = Number(rows[0].id);
  const ativo = await inserirPokemon(playerId, PIKACHU, { slot: 1 });
  await pool.query(`UPDATE players SET active_poke = $2 WHERE id = $1`, [playerId, ativo]);
  const ids = [];
  for (let i = 0; i < depot; i++) ids.push(await inserirPokemon(playerId, CHARMANDER));
  const ids5 = [];
  for (let i = 0; i < p5; i++) ids5.push(await inserirPokemon(playerId, CHARMANDER, { potencia: 5 }));
  return { nick, playerId, ativo, depot: ids, p5: ids5 };
}

async function apagarContas() {
  for (const nick of criadas) {
    const { rows } = await pool.query(`SELECT id FROM players WHERE lower(nick) = lower($1)`, [nick]);
    const id = rows[0]?.id;
    if (id) {
      // A casa fica ÓRFÃ (`dono_id` vira NULL) se o jogador sair antes dela.
      await pool.query(`DELETE FROM casas WHERE dono_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM market_anuncios WHERE vendedor_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM player_pokemon WHERE player_id = $1`, [id]).catch(() => {});
    }
    await pool.query(`DELETE FROM accounts WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
  }
}

const vivos = async (ids) => {
  const { rows } = await pool.query(`SELECT id FROM player_pokemon WHERE id = ANY($1::bigint[])`, [ids]);
  return new Set(rows.map((r) => Number(r.id)));
};
const donoDe = async (id) => {
  const { rows } = await pool.query(`SELECT player_id, anuncio_id FROM player_pokemon WHERE id = $1`, [id]);
  return rows[0] ? { dono: Number(rows[0].player_id), anuncio: rows[0].anuncio_id } : null;
};
const giros = async (playerId) => {
  const { rows } = await pool.query(
    `SELECT acao, detalhe, ref FROM player_gameplay_log WHERE player_id = $1 AND categoria = 'oferenda' ORDER BY id`,
    [playerId],
  );
  return rows;
};
/** As pedras na bolsa, lidas do BANCO — espera o write-behind gravar o que o sim tem. */
async function pedrasNoBanco(playerId, esperadas, ms = 15000) {
  const fim = Date.now() + ms;
  let total = 0;
  while (Date.now() < fim) {
    const { rows } = await pool.query(`SELECT items FROM players WHERE id = $1`, [playerId]);
    const items = typeof rows[0].items === 'string' ? JSON.parse(rows[0].items) : (rows[0].items ?? {});
    total = Object.values(items).reduce((s, v) => s + Number(v || 0), 0);
    if (total === esperadas) return total;
    await dormir(500);
  }
  return total;
}
async function ouroNoBanco(playerId) {
  const { rows } = await pool.query(`SELECT gold FROM players WHERE id = $1`, [playerId]);
  return Number(rows[0].gold);
}

// ------------------------------------------------------------------ socket

function conectar(nick) {
  const c = { nick, ws: new WebSocket(URL), eventos: [], mercado: [], erro: null, estado: null };
  // A coleção que a TELA recebe, mesclada do jeito que o cliente mescla — é dela que a folha da
  // Oferenda tira os cards.
  const mesclar = criarMescladorDeEstado();
  c.pronto = new Promise((resolve, reject) => {
    c.ws.on('open', async () => {
      try {
        c.ws.send(JSON.stringify(helloCom(await sessaoDe(nick))));
      } catch (err) {
        reject(err);
      }
    });
    c.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') {
        c.estado = mesclar(m.estado);
        resolve();
      }
      if (m.t === 'estado') c.estado = mesclar(m.estado);
      if (m.t === 'erro') {
        c.erro = m.chave ?? m.msg;
        reject(new Error(`${nick}: ${c.erro}`));
      }
      if (Array.isArray(m.ev)) c.eventos.push(...m.ev);
      if (m.t === 'market') c.mercado.push(m);
    });
    c.ws.on('error', reject);
  });
  /** Tudo no MESMO tique do event loop: é o que um script faria para disputar a fila. */
  c.rajada = (...pacotes) => {
    for (const o of pacotes) c.ws.send(JSON.stringify(o));
  };
  c.de = (k) => c.eventos.filter((e) => e.k === k);
  c.naTela = (id) => (c.estado?.pokemons ?? []).some((pk) => Number(pk.id) === Number(id));
  c.avisos = () => c.de('aviso').map((e) => String(e.msg));
  c.fechar = () => new Promise((r) => {
    c.ws.once('close', r);
    c.ws.close();
  });
  return c;
}

async function ate(cond, ms = 10000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cond()) return true;
    await dormir(150);
  }
  return false;
}

const girar = (pokemonIds, extra = {}) => ({ t: 'oferenda.girar', pokemonIds, ...extra });
/** Quantas respostas (roleta ou recusa) o servidor já deu. */
const respostas = (c) => c.de('oferenda').length + c.avisos().filter((a) => a.startsWith('oferenda.')).length;

// ------------------------------------------------------------------ cenários

console.log(`OFERENDA — ataques pelo socket (${URL})\n${'='.repeat(46)}`);
ok(OFERENDA_CASAS === 5, 'a roleta tem cinco casas', String(OFERENDA_CASAS));

try {
  // ---------------------------------------------------------------------------------------
  secao('1. O mesmo pokémon repetido na mesma oferenda');
  {
    const conta = await criarConta('a', { depot: 3 });
    const c = conectar(conta.nick);
    await c.pronto;
    const [x] = conta.depot;
    c.rajada(girar([x, x, x, x, x, String(x), x]));
    ok(await ate(() => c.de('oferenda').length === 1), 'o giro responde');
    const r = c.de('oferenda')[0];
    ok(r?.oferecidos === 1, 'cinco vezes o mesmo id viram UM pokémon', `oferecidos=${r?.oferecidos}`);
    const pesoPedra = (r?.fatias ?? []).filter((f) => !f.vazio).reduce((s, f) => s + f.peso, 0);
    ok(r && pesoPedra * 5 === r.total, 'e a chance de pedra é 20%, não 100%', `${pesoPedra}/${r?.total}`);
    const v = await vivos(conta.depot);
    ok(!v.has(x) && v.size === 2, 'só aquele pokémon saiu do banco', `vivos: ${[...v].join(',')}`);
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('2. A rajada: o mesmo giro seis vezes no mesmo instante');
  {
    // Doze no depot: depois do giro sobram oito, e a recusa dos repetidos tem de ser por POSSE —
    // com quatro, a regra do último pokémon (`erroUltimo`) respondia antes.
    const conta = await criarConta('b', { depot: 12 });
    const c = conectar(conta.nick);
    await c.pronto;
    const lote = conta.depot.slice(0, 5);
    c.rajada(...Array.from({ length: 6 }, () => girar(lote)));
    ok(await ate(() => respostas(c) >= 6), 'as seis respostas chegam', `veio ${respostas(c)}`);
    ok(c.de('oferenda').length === 1, 'só UM giro acontece', `giros: ${c.de('oferenda').length}`);
    ok(
      c.avisos().filter((a) => a === 'oferenda.erroNaoTem').length === 5,
      'os outros cinco são recusados: os pokémon já não existem',
      c.avisos().join(' | '),
    );
    const v = await vivos(conta.depot);
    ok(lote.every((id) => !v.has(id)) && v.size === 7, 'o banco perdeu exatamente os cinco', `vivos: ${v.size}`);
    ok(await ate(async () => (await giros(conta.playerId)).length === 1, 4000), 'a auditoria registra UM giro');
    const ganhou = c.de('oferenda')[0]?.itemId != null;
    ok(await pedrasNoBanco(conta.playerId, ganhou ? 1 : 0) === (ganhou ? 1 : 0), `e a bolsa tem ${ganhou ? 'uma pedra' : 'zero pedras'} — nunca duas`);
    // O replay depois do fim: o mesmo pacote, agora que a fila esvaziou (e o balde, que a rajada
    // secou, tem um giro de novo).
    await dormir(4200);
    c.eventos.length = 0;
    c.rajada(girar(lote));
    ok(await ate(() => c.avisos().includes('oferenda.erroNaoTem')), 'reenviar o pacote depois é recusado');
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('3. Queimar e vender ao NPC ao mesmo tempo');
  {
    const conta = await criarConta('c', { depot: 6 });
    const c = conectar(conta.nick);
    await c.pronto;
    const ouroAntes = await ouroNoBanco(conta.playerId);
    const [x, y] = conta.depot;
    // As duas ordens: venda chegando depois do giro (x) e antes dele (y).
    c.rajada(girar([x]), { t: 'shop.sellPokemon', pokemonId: x });
    c.rajada({ t: 'shop.sellPokemon', pokemonId: y }, girar([y]));
    const doNpc = () => c.de('venda').length + c.avisos().filter((a) => /não está mais/.test(a)).length;
    ok(await ate(() => respostas(c) >= 2 && doNpc() >= 2),
      'as quatro respostas chegam', JSON.stringify(c.eventos.map((e) => e.k + ':' + (e.msg ?? ''))));
    const vendas = c.de('venda');
    const oferendas = c.de('oferenda');
    ok(oferendas.length === 1 && vendas.length === 1, 'cada pokémon teve UM destino: um queimado, um vendido',
      `giros ${oferendas.length}, vendas ${vendas.length}`);
    ok(c.avisos().includes('oferenda.erroNaoTem'), 'o giro que chegou depois da venda é recusado');
    ok(c.avisos().some((a) => /não está mais com você/.test(a)), 'a venda que chegou depois do giro é recusada');
    const v = await vivos([x, y]);
    ok(v.size === 0, 'os dois saíram do banco, uma vez cada');
    await dormir(6000);
    const ouroDepois = await ouroNoBanco(conta.playerId);
    ok(ouroDepois - ouroAntes === vendas[0]?.ganho, 'o ouro subiu por UMA venda só', `${ouroAntes} → ${ouroDepois}, venda ${vendas[0]?.ganho}`);
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('4. Queimar e vender o depot inteiro ao mesmo tempo');
  {
    const conta = await criarConta('d', { depot: 9 });
    const c = conectar(conta.nick);
    await c.pronto;
    const lote = conta.depot.slice(0, 5);
    c.rajada(girar(lote), { t: 'shop.sellAllPokemons' });
    ok(await ate(() => c.de('venda').length === 1 && respostas(c) >= 1), 'o giro e a venda em lote respondem');
    const venda = c.de('venda')[0];
    const giro = c.de('oferenda')[0];
    ok(!!giro, 'o giro, que chegou primeiro, acontece');
    ok(venda?.qtd === conta.depot.length - lote.length,
      'o lote vende SÓ o que sobrou — nenhum dos queimados', `vendeu ${venda?.qtd} de ${conta.depot.length}`);
    const v = await vivos(conta.depot);
    ok(v.size === 0, 'o depot inteiro saiu do banco, cada um por um caminho');
    ok(await pedrasNoBanco(conta.playerId, giro?.itemId != null ? 1 : 0) === (giro?.itemId != null ? 1 : 0), 'e a bolsa bate com o giro');
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('5. Queimar e anunciar no Mercado ao mesmo tempo');
  {
    const conta = await criarConta('e', { depot: 3, p5: 3 });
    const c = conectar(conta.nick);
    await c.pronto;
    const [x, y, z] = conta.p5;
    const anunciar = (id) => ({ t: 'market.criar', tipo: 'pokemon', pokemonId: id, preco: 50000, moeda: 'gold', dias: 1 });
    // x: giro primeiro, anúncio depois. y: anúncio primeiro, giro depois.
    c.rajada(girar([x]), anunciar(x));
    c.rajada(anunciar(y), girar([y]));
    ok(await ate(() => respostas(c) >= 2 && c.de('marketCriado').length >= 1), 'as respostas chegam',
      JSON.stringify(c.eventos.map((e) => e.k + ':' + (e.msg ?? ''))));
    const dx = await donoDe(x);
    const dy = await donoDe(y);
    ok(dx === null, 'x foi queimado e NÃO virou anúncio', JSON.stringify(dx));
    ok(dy?.anuncio != null && dy.dono === conta.playerId, 'y virou anúncio e NÃO foi queimado', JSON.stringify(dy));
    ok(c.de('oferenda').length === 1 && c.de('marketCriado').length === 1, 'um giro e um anúncio, nada em dobro');
    const { rows: anuncios } = await pool.query(
      `SELECT pokemon_id FROM market_anuncios WHERE vendedor_id = $1 AND estado = 'aberto'`, [conta.playerId],
    );
    ok(anuncios.length === 1 && Number(anuncios[0].pokemon_id) === y, 'só o anúncio de y existe', JSON.stringify(anuncios));

    secao('6. Queimar o que já está à venda');
    c.eventos.length = 0;
    c.rajada(anunciar(z));
    ok(await ate(() => c.de('marketCriado').length === 1), 'z vai para a vitrine');
    await dormir(4200); // o balde de oferenda enche de novo
    c.rajada(girar([z]), girar([y, z]));
    ok(await ate(() => c.avisos().filter((a) => a === 'oferenda.erroNaoTem').length === 2),
      'queimar um pokémon anunciado é recusado', c.avisos().join(' | '));
    const dz = await donoDe(z);
    ok(dz?.anuncio != null && dz.dono === conta.playerId, 'e o anúncio continua inteiro', JSON.stringify(dz));
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('6b. O SHINY anunciado no Mercado não entra na Oferenda');
  {
    const conta = await criarConta('k', { depot: 6 });
    const g1 = await inserirPokemon(conta.playerId, GENGAR, { shiny: true });
    const g2 = await inserirPokemon(conta.playerId, GENGAR, { shiny: true });
    let c = conectar(conta.nick);
    await c.pronto;
    ok(c.naTela(g1) && c.naTela(g2), 'os dois Shiny Gengar chegam à tela antes de anunciar');

    const anunciar = (id) => ({ t: 'market.criar', tipo: 'pokemon', pokemonId: id, preco: 900000, moeda: 'gold', dias: 1 });
    c.rajada(anunciar(g1));
    ok(await ate(() => c.de('marketCriado').length === 1), 'o Shiny Gengar vai para a vitrine (shiny passa na curadoria)',
      c.avisos().join(' | '));
    ok(await ate(() => !c.naTela(g1), 3000), 'e some da coleção que a tela recebe — a folha da Oferenda não tem como mostrá-lo');

    c.rajada(girar([g1]), girar([g1, conta.depot[0]]));
    ok(await ate(() => c.avisos().filter((a) => a === 'oferenda.erroNaoTem').length === 2),
      'o giro com o Shiny Gengar anunciado é recusado — sozinho e acompanhado', c.avisos().join(' | '));
    ok(c.de('oferenda').length === 0, 'nenhum giro acontece');
    const dg1 = await donoDe(g1);
    ok(dg1?.dono === conta.playerId && dg1.anuncio != null, 'o Shiny Gengar continua no banco, preso ao anúncio', JSON.stringify(dg1));
    ok((await vivos([conta.depot[0]])).size === 1, 'e o companheiro de lote não foi queimado');

    // Relogar: a coleção vem do BANCO, e o banco não entrega o que está em escrow.
    await c.fechar();
    const recarregado = await carregarOuCriarJogador(conta.nick);
    ok(!recarregado.pokemons.some((r) => Number(r.id) === g1), 'na carga do login, o anunciado não vem junto');
    c = conectar(conta.nick);
    await c.pronto;
    ok(!c.naTela(g1), 'e depois de reconectar ele segue fora da tela');
    c.rajada(girar([g1]));
    ok(await ate(() => c.avisos().includes('oferenda.erroNaoTem')), 'e o giro com ele segue recusado');

    // Anunciado por OUTRO processo, sem este saber: a memória ainda tem o g2, o banco já o
    // prendeu num anúncio. Quem segura aqui é o `anuncio_id IS NULL` do DELETE.
    const { rows: novo } = await pool.query(
      `INSERT INTO market_anuncios (vendedor_id, vendedor, tipo, pokemon_id, ficha, preco, moeda)
       VALUES ($1, $2, 'pokemon', $3, '{"nome":"Gengar","shiny":true}'::jsonb, 900000, 'gold') RETURNING id`,
      [conta.playerId, conta.nick, g2],
    );
    await pool.query(`UPDATE player_pokemon SET anuncio_id = $1 WHERE id = $2`, [novo[0].id, g2]);
    ok(c.naTela(g2), 'o outro Shiny Gengar ainda está na memória deste processo');
    c.eventos.length = 0;
    c.rajada(girar([g2, conta.depot[1]]));
    ok(await ate(() => c.avisos().includes('oferenda.erroFalhou')), 'o giro com ele é recusado pelo banco', c.avisos().join(' | '));
    ok(c.de('oferenda').length === 0, 'sem giro');
    const dg2 = await donoDe(g2);
    ok(dg2?.dono === conta.playerId && Number(dg2.anuncio) === Number(novo[0].id), 'o Shiny Gengar e o anúncio dele ficam intactos', JSON.stringify(dg2));
    ok((await vivos([conta.depot[1]])).size === 1, 'e o companheiro de lote voltou inteiro');
    ok(await ate(() => !c.naTela(g2), 3000), 'e ele sai da memória: a tela para de oferecê-lo');
    ok((await giros(conta.playerId)).length === 0, 'a auditoria não tem giro nenhum');

    // A prova de que era o ANÚNCIO que barrava: cancelado, o Gengar volta e gira normalmente.
    const { rows: meus } = await pool.query(
      `SELECT id FROM market_anuncios WHERE pokemon_id = $1 AND estado = 'aberto'`, [g1],
    );
    c.eventos.length = 0;
    c.rajada({ t: 'market.cancelar', id: Number(meus[0].id) });
    ok(await ate(() => c.naTela(g1), 5000), 'cancelado o anúncio, o Shiny Gengar volta para a tela');
    await dormir(4200);
    c.rajada(girar([g1]));
    ok(await ate(() => c.de('oferenda').length === 1), 'e aí, sim, ele entra na Oferenda', c.avisos().join(' | '));
    const r = c.de('oferenda')[0];
    ok(r?.fatias?.filter((f) => !f.vazio).every((f) => f.shiny), 'pintando só Shiny Stone (Ghost e Poison)',
      JSON.stringify(r?.fatias?.map((f) => f.nome)));
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('6c. Quem segura Exp. Share e quem está no posto de uma Casa');
  {
    const conta = await criarConta('m', { depot: 6 });
    // `xp_share_total` = o direito: sem ele, a conferência do login trataria o item como suspeito.
    await pool.query(`UPDATE players SET xp_share_total = 1 WHERE id = $1`, [conta.playerId]);
    const segurando = await inserirPokemon(conta.playerId, CHARMANDER, { held: XP_SHARE_HELD_ID });
    const naCasa = await inserirPokemon(conta.playerId, CHARMANDER, { slot: 2 });
    const { rows: casa } = await pool.query(
      `INSERT INTO casas (raridade, dono_id, criador_id, criador, origem)
       VALUES ('comum', $1, $1, $2, 'fabricada') RETURNING id`,
      [conta.playerId, conta.nick],
    );
    const casaId = Number(casa[0].id);
    const c = conectar(conta.nick);
    await c.pronto;
    const postos = () => (c.estado?.casa?.lista ?? []).flatMap((x) => x.postos ?? []);
    c.rajada({ t: 'xpshare.escolher', casaId, slot: 0, pokemonId: naCasa });
    ok(await ate(() => postos().includes(naCasa), 5000), 'o Charmander da equipe vai para o posto da Casa',
      JSON.stringify(c.estado?.casa?.lista));

    c.rajada(girar([segurando]), girar([naCasa]), girar([naCasa, conta.depot[0]]));
    ok(await ate(() => respostas(c) >= 3), 'as três respostas chegam', c.avisos().join(' | '));
    ok(c.de('oferenda').length === 0, 'nenhum giro acontece');
    ok(c.avisos().includes('oferenda.erroXpShare'), 'quem segura Exp. Share é recusado', c.avisos().join(' | '));
    ok(c.avisos().filter((a) => a === 'oferenda.erroCasa').length === 2,
      'quem está no posto da Casa é recusado — sozinho e acompanhado — com a frase da Casa', c.avisos().join(' | '));
    const { rows: vivosAgora } = await pool.query(
      `SELECT id, held_item_id FROM player_pokemon WHERE id = ANY($1::bigint[])`, [[segurando, naCasa, conta.depot[0]]],
    );
    ok(vivosAgora.length === 3, 'os três continuam no banco');
    ok(Number(vivosAgora.find((r) => Number(r.id) === segurando)?.held_item_id) === XP_SHARE_HELD_ID,
      'e o Exp. Share continua no pokémon');
    ok(postos().includes(naCasa), 'e o posto continua ocupado');

    // Soltos, os dois entram: a trava era o Exp. Share e o posto, e nada mais.
    c.eventos.length = 0;
    c.rajada(
      { t: 'xpshareheld.remover', pokemonId: segurando },
      { t: 'xpshare.escolher', casaId, slot: 0, pokemonId: null },
      { t: 'centro.ir' },
    );
    ok(await ate(() => !postos().includes(naCasa), 5000), 'o posto é esvaziado');
    await dormir(1500);
    c.rajada({ t: 'team.move', pokemonId: naCasa, slot: null });
    await dormir(1200);
    c.rajada(girar([segurando, naCasa]));
    ok(await ate(() => c.de('oferenda').length === 1), 'sem Exp. Share e fora da Casa, os dois entram na Oferenda',
      c.avisos().join(' | '));
    ok(c.de('oferenda')[0]?.oferecidos === 2, 'os dois', `oferecidos=${c.de('oferenda')[0]?.oferecidos}`);
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('7. Queimar e tirar: mover para a equipe e ativar no meio do giro');
  {
    const conta = await criarConta('f', { depot: 3 });
    const c = conectar(conta.nick);
    await c.pronto;
    // O depot só se mexe no Centro — é onde um jogador de verdade estaria para tentar isto.
    c.rajada({ t: 'centro.ir' });
    await dormir(1500);
    const [x] = conta.depot;
    // O giro sai primeiro; os pedidos de "tirar" vêm logo atrás, espalhados em milissegundos, para
    // que algum caia DENTRO do `await` do banco — a janela em que o pokémon já foi validado para a
    // queima e ainda não tinha saído da memória.
    c.rajada(girar([x]));
    for (const ms of [0, 1, 2, 4, 8, 16, 32]) {
      setTimeout(() => c.rajada({ t: 'team.move', pokemonId: x, slot: 2 }, { t: 'team.active', pokemonId: x }), ms);
    }
    ok(await ate(() => respostas(c) >= 1), 'o giro responde');
    await dormir(1500);
    const queimou = c.de('oferenda').length === 1;
    // Duas ordens são legítimas: o giro na frente (o pokémon some, e mover é recusado) ou, se o
    // sim despachar os pacotes no mesmo tique, o "mover" na frente (e aí o giro recusa um pokémon
    // da equipe). O que nunca pode acontecer é as duas coisas valerem.
    if (queimou) {
      ok(c.avisos().some((a) => /não está mais com você/.test(a)), 'o giro veio primeiro: mover no meio dele é recusado', c.avisos().join(' | '));
    } else {
      ok(c.avisos().includes('oferenda.erroEquipe'), 'o mover veio primeiro: o giro recusa o pokémon da equipe', c.avisos().join(' | '));
    }
    await dormir(6000);
    const vivoX = (await vivos([x])).size === 1;
    const { rows } = await pool.query(`SELECT active_poke FROM players WHERE id = $1`, [conta.playerId]);
    const ativo = Number(rows[0].active_poke);
    const { rows: equipe } = await pool.query(
      `SELECT id FROM player_pokemon WHERE player_id = $1 AND slot IS NOT NULL ORDER BY id`, [conta.playerId],
    );
    const idsEquipe = equipe.map((r) => Number(r.id));
    if (queimou) {
      ok(!vivoX, 'o pokémon saiu do banco');
      // Nenhum "ativo fantasma" apontando para a linha apagada.
      ok(ativo === conta.ativo, 'o ativo continua o Pikachu', `active_poke=${ativo}`);
      ok(idsEquipe.length === 1 && idsEquipe[0] === conta.ativo, 'e a equipe no banco é só ele', JSON.stringify(idsEquipe));
    } else {
      ok(vivoX && idsEquipe.includes(x), 'o pokémon continua vivo, na equipe', JSON.stringify(idsEquipe));
      ok((await giros(conta.playerId)).length === 0, 'e nenhum giro foi registrado');
    }
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('8. Memória velha: a linha mudou de dono no banco com o jogador on-line');
  {
    const conta = await criarConta('g', { depot: 6 });
    const outra = await criarConta('h', { depot: 1 });
    const c = conectar(conta.nick);
    await c.pronto;
    const [y, z, w] = conta.depot;
    // É o que outro processo com o mesmo jogador carregado faria: a linha já foi embora.
    await pool.query(`UPDATE player_pokemon SET player_id = $1 WHERE id = $2`, [outra.playerId, y]);
    c.rajada(girar([y, z]));
    ok(await ate(() => respostas(c) >= 1), 'o giro responde');
    ok(c.de('oferenda').length === 0, 'não há giro', JSON.stringify(c.de('oferenda')));
    ok(c.avisos().includes('oferenda.erroFalhou'), 'o jogador recebe a recusa', c.avisos().join(' | '));
    const dy = await donoDe(y);
    ok(dy?.dono === outra.playerId, 'o pokémon da OUTRA conta não foi apagado', JSON.stringify(dy));
    ok((await vivos([z])).size === 1, 'e o outro do lote voltou inteiro (a transação desfez tudo)');
    ok(await ate(async () => (await giros(conta.playerId)).length === 0, 1500), 'a auditoria não registra giro nenhum');

    await dormir(4200);
    c.eventos.length = 0;
    c.rajada(girar([z]));
    ok(await ate(() => c.de('oferenda').length === 1), 'o pokémon que era dele gira normalmente depois');
    await dormir(4200);
    c.eventos.length = 0;
    c.rajada(girar([y]));
    ok(await ate(() => c.avisos().includes('oferenda.erroNaoTem')),
      'e o que mudou de dono saiu da memória: não tenta de novo', c.avisos().join(' | '));

    // A mesma coisa com a linha APAGADA por fora (um admin, outro processo).
    await pool.query(`DELETE FROM player_pokemon WHERE id = $1`, [w]);
    await dormir(4200);
    c.eventos.length = 0;
    const [, , , a4] = conta.depot;
    c.rajada(girar([w, a4]));
    ok(await ate(() => c.avisos().includes('oferenda.erroFalhou')), 'com a linha apagada por fora, o giro também volta');
    ok((await vivos([a4])).size === 1, 'e o companheiro de lote continua vivo');
    ok((await giros(conta.playerId)).length === 1, 'a auditoria só tem o giro que valeu');
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('9. O pacote inflado');
  {
    const conta = await criarConta('i', { depot: 9 });
    const outra = await criarConta('j', { depot: 2 });
    const c = conectar(conta.nick);
    await c.pronto;
    // Sete ids distintos: só os cinco primeiros entram.
    const sete = conta.depot.slice(0, 7);
    c.rajada(girar(sete, {
      // Campos de RESULTADO que um cliente adulterado tentaria impor. O servidor sorteia.
      indice: 0, itemId: 999999, pedra: 'Dragon Shiny Stone', chancePedra: 1,
      fatias: [{ itemId: 999999, peso: 1 }], total: 1, casas: 99,
    }));
    ok(await ate(() => c.de('oferenda').length === 1), 'o giro responde');
    const r = c.de('oferenda')[0];
    ok(r?.oferecidos === 5 && r?.casas === 5, 'só cinco pokémon entram, e a roleta tem cinco casas', `oferecidos=${r?.oferecidos} casas=${r?.casas}`);
    ok(r?.itemId !== 999999 && (r?.fatias ?? []).every((f) => f.itemId !== 999999), 'o item forjado não aparece em lugar nenhum');
    ok(r?.fatias?.length === 1 && r.fatias[0].nome === 'Fire Stone', 'a roleta é a de verdade: cinco Charmander, 100% Fire Stone',
      JSON.stringify(r?.fatias?.map((f) => f.nome)));
    const v = await vivos(sete);
    ok(v.size === 2 && v.has(sete[5]) && v.has(sete[6]), 'o sexto e o sétimo continuam no banco', `vivos: ${[...v].join(',')}`);

    await dormir(4200);
    c.eventos.length = 0;
    // A lista longa vem primeiro (o balde deixa passar seis) e cabe nos 16 kB do socket: o
    // teto do servidor para a varredura é o que se mede aqui, não o `maxPayload`.
    const lixos = [
      Array.from({ length: 1500 }, () => conta.depot[7]),
      null, 'abc', 42, { id: conta.depot[7] }, [[conta.depot[7]]], [-1, 0, 1.5, 1e300, NaN],
    ];
    for (const lixo of lixos) c.rajada(girar(lixo));
    await dormir(2500);
    ok(c.de('oferenda').length <= 1, 'lixo não vira giro (no máximo o id repetido, deduplicado)', `giros ${c.de('oferenda').length}`);
    // Pokémon de OUTRA conta.
    await dormir(8000);
    c.eventos.length = 0;
    c.rajada(girar([outra.depot[0]]));
    ok(await ate(() => c.avisos().includes('oferenda.erroNaoTem')), 'o pokémon de outra conta é recusado');
    ok((await vivos([outra.depot[0]])).size === 1, 'e ele continua no banco');
    // O ativo e o último da conta.
    await dormir(4200);
    c.eventos.length = 0;
    c.rajada(girar([conta.ativo]));
    ok(await ate(() => c.avisos().includes('oferenda.erroAtivo')), 'o ativo é recusado');
    ok(c.ws.readyState === WebSocket.OPEN, 'e a conexão sobreviveu a tudo isso');
    await c.fechar();
  }
} catch (err) {
  falhas++;
  console.log(`  ✗ o roteiro quebrou: ${err.stack ?? err.message}`);
} finally {
  await dormir(500);
  await apagarContas();
  await pool.end().catch(() => {});
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
