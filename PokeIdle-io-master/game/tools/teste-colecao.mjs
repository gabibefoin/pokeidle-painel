// A COLEÇÃO sob ATAQUE — pacotes forjados contra o servidor no ar.
//
// A Coleção é o antigo cadeado de venda: uma MARCA (`automation.pokemonTravado`) sobre a mesma
// linha de `player_pokemon`. Este teste fala direto com o socket, manda o que a tela nunca manda e
// confere no BANCO e na memória que:
//
//   · **nada duplica**: mover entre Depot e Coleção não cria nem apaga linha, nem em rajada;
//   · **a venda respeita a marca** — a unitária, o lote e as corridas com o mover na mesma fila;
//   · **a espera por pokémon** (3 s) e o **balde por conta** seguram o laço de entra-e-sai;
//   · **o pacote torto** (destino inventado, id de outra conta, lixo no lugar do id) não muda nada;
//   · **a resposta sempre traz o estado real**, inclusive na recusa;
//   · **o cadeado antigo** (`shop.lockPokemon`) passa pela mesma regra;
//   · **a Coleção sobrevive ao Mercado e ao relogin**: o anunciado continua nela, e o id que não é
//     mais do jogador sai da lista no login;
//   · **a Oferenda e o Mercado aceitam** pokémon da Coleção (ela só barra o NPC).
//
// Cada cenário usa uma conta própria (o balde é por conta). As contas nascem direto no banco e
// são apagadas no fim.
//
// Precisa do servidor de pé:
//
//   npm start
//   node tools/teste-colecao.mjs        (npm run test:colecao)
import { WebSocket } from 'ws';
import { sessaoDe } from './sessao-local.mjs';
import { helloCom } from './auth-teste.mjs';
import { pool } from '../src/server/db.mjs';
import { criarMescladorDeEstado } from '../src/shared/estado-delta.mjs';
import { especies, xpTotalParaNivel } from '../src/server/content.mjs';

const URL = process.env.WS_URL ?? 'ws://localhost:8080';
const MARCA = Date.now().toString(36).slice(-5);
const IVS = { hp: 24, atk: 24, def: 24, spAtk: 24, spDef: 24, speed: 24 };
const ESPERA_MS = 3000; // COLECAO_COOLDOWN_MS, em `server/sim.mjs`

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
const PIKACHU = especiePorNome('Pikachu');
const criadas = [];

async function inserirPokemon(playerId, esp, { slot = null, potencia = 1, level = 60, shiny = false } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia, slot)
     VALUES ($1, $2, $3, 1.2, $4::jsonb, 9999, $7, $5, $6) RETURNING id`,
    [playerId, esp.pokeId, level, JSON.stringify(IVS), potencia, slot, shiny],
  );
  return Number(rows[0].id);
}

/**
 * Conta pronta: o ativo na equipe, um segundo na equipe e `depot` Charmander iguais (mesmo preço
 * no NPC). `colecao` são ids que já nascem na Coleção (índices do depot), e `lixo` entra cru na
 * lista gravada — é o que o login tem de limpar.
 */
async function criarConta(sufixo, { depot = 8, colecao = [], lixo = [] } = {}) {
  const nick = `col${MARCA}${sufixo}`;
  criadas.push(nick);
  await pool.query(
    `INSERT INTO accounts (nick, email, provedor, email_ok) VALUES ($1, $2, 'local', true)`,
    [nick, `${nick}@test.local`],
  );
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp, gold, visual_ok, tutorial_visto, discord_pop_campanha, aviso_visto)
     VALUES ($1, 150, $2, 1000000, true, true, 99, 99) RETURNING id`,
    [nick, xpTotalParaNivel(150)],
  );
  const playerId = Number(rows[0].id);
  const ativo = await inserirPokemon(playerId, PIKACHU, { slot: 0 });
  const segundo = await inserirPokemon(playerId, PIKACHU, { slot: 1 });
  await pool.query(`UPDATE players SET active_poke = $2 WHERE id = $1`, [playerId, ativo]);
  const ids = [];
  for (let i = 0; i < depot; i++) ids.push(await inserirPokemon(playerId, CHARMANDER));
  const lista = [...colecao.map((i) => ids[i]), ...lixo];
  // Sem o Auto Coleção Shiny ligado de fábrica mexendo na lista (não há shiny aqui, mas a regra
  // fica explícita), e com a lista que o cenário pediu.
  await pool.query(
    `UPDATE players SET automation = jsonb_build_object('pokemonTravado', $2::jsonb, 'autoLockShiny', false) WHERE id = $1`,
    [playerId, JSON.stringify(lista)],
  );
  return { nick, playerId, ativo, segundo, depot: ids };
}

async function apagarContas() {
  for (const nick of criadas) {
    const { rows } = await pool.query(`SELECT id FROM players WHERE lower(nick) = lower($1)`, [nick]);
    const id = rows[0]?.id;
    if (id) {
      await pool.query(`DELETE FROM market_anuncios WHERE vendedor_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM player_pokemon WHERE player_id = $1`, [id]).catch(() => {});
    }
    await pool.query(`DELETE FROM accounts WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
  }
}

/** Quantas linhas de pokémon a conta tem no banco (anunciados inclusos). */
async function linhasDe(playerId) {
  const { rows } = await pool.query(`SELECT id FROM player_pokemon WHERE player_id = $1 ORDER BY id`, [playerId]);
  return rows.map((r) => Number(r.id));
}
/** A Coleção gravada no banco — espera o write-behind alcançar o que o sim tem. */
async function colecaoNoBanco(playerId, esperada = null, ms = 15000) {
  const fim = Date.now() + ms;
  let lista = [];
  while (Date.now() < fim) {
    const { rows } = await pool.query(`SELECT automation FROM players WHERE id = $1`, [playerId]);
    const auto = typeof rows[0].automation === 'string' ? JSON.parse(rows[0].automation) : rows[0].automation;
    lista = (auto?.pokemonTravado ?? []).map(Number).sort((a, b) => a - b);
    if (!esperada || JSON.stringify(lista) === JSON.stringify([...esperada].sort((a, b) => a - b))) return lista;
    await dormir(500);
  }
  return lista;
}

// ------------------------------------------------------------------ socket

function conectar(nick) {
  const c = { nick, ws: new WebSocket(URL), eventos: [], erros: [], estado: null };
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
        c.erros.push(m.chave ?? m.msg);
        if (!c.estado) reject(new Error(`${nick}: ${m.chave ?? m.msg}`));
      }
      if (Array.isArray(m.ev)) c.eventos.push(...m.ev);
    });
    c.ws.on('error', reject);
  });
  c.rajada = (...pacotes) => {
    for (const o of pacotes) c.ws.send(JSON.stringify(o));
  };
  c.de = (k) => c.eventos.filter((e) => e.k === k);
  c.avisos = () => c.de('aviso').map((e) => String(e.msg));
  c.colecao = () => (c.estado?.automation?.pokemonTravado ?? []).map(Number);
  c.naTela = (id) => (c.estado?.pokemons ?? []).some((pk) => Number(pk.id) === Number(id));
  c.ouro = () => Number(c.estado?.gold ?? 0);
  c.limpar = () => {
    c.eventos.length = 0;
    c.erros.length = 0;
  };
  c.fechar = () => new Promise((r) => {
    if (c.ws.readyState === WebSocket.CLOSED) return r();
    c.ws.once('close', r);
    c.ws.close();
  });
  return c;
}

async function ate(cond, ms = 10000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cond()) return true;
    await dormir(120);
  }
  return false;
}

const mover = (pokemonId, para) => ({ t: 'colecao.mover', pokemonId, para });
const vender = (pokemonId) => ({ t: 'shop.sellPokemon', pokemonId });
const respostasDe = (c, id) => c.de('colecao').filter((e) => Number(e.id) === Number(id));

/** Conecta e espera o sim terminar o login (a lista já limpa, o welcome na mão). */
async function entrar(conta) {
  const c = conectar(conta.nick);
  await c.pronto;
  return c;
}

// ------------------------------------------------------------------ cenários

console.log(`COLEÇÃO — ataques pelo socket (${URL})\n${'='.repeat(44)}`);

try {
  // ---------------------------------------------------------------------------------------
  secao('1. Mover para a Coleção e de volta, com a espera');
  {
    const conta = await criarConta('a', { depot: 4 });
    const c = await entrar(conta);
    const [x] = conta.depot;
    const antes = await linhasDe(conta.playerId);

    c.rajada(mover(x, 'colecao'));
    ok(await ate(() => respostasDe(c, x).length === 1), 'o servidor responde');
    ok(respostasDe(c, x)[0]?.naColecao === true, 'com o estado real: na Coleção', JSON.stringify(respostasDe(c, x)[0]));
    ok(await ate(() => c.colecao().includes(x)), 'e o estado da tela traz o id na lista');

    c.limpar();
    c.rajada(mover(x, 'colecao'));
    ok(await ate(() => respostasDe(c, x).length === 1), 'pedir de novo o mesmo lado responde');
    ok(respostasDe(c, x)[0]?.naColecao === true && !respostasDe(c, x)[0]?.recusado && !c.avisos().length,
      'sem mudar nada e sem aviso (não conta como troca)', JSON.stringify(c.eventos));

    c.limpar();
    c.rajada(mover(x, 'depot'));
    ok(await ate(() => respostasDe(c, x).length === 1), 'voltar logo em seguida responde');
    const r = respostasDe(c, x)[0];
    ok(r?.recusado === true && r?.naColecao === true, 'e é RECUSADO pela espera, com o estado real', JSON.stringify(r));
    ok(c.avisos().includes('colecao.espere'), 'com o aviso da espera', c.avisos().join(' | '));
    const espere = c.de('aviso').find((e) => e.msg === 'colecao.espere');
    ok(espere?.params?.s >= 1 && espere?.params?.s <= 3, 'que diz quantos segundos faltam', JSON.stringify(espere));
    ok(c.colecao().includes(x), 'o pokémon continua na Coleção');

    await dormir(ESPERA_MS + 200);
    c.limpar();
    c.rajada(mover(x, 'depot'));
    ok(await ate(() => respostasDe(c, x).length === 1), 'depois da espera, voltar responde');
    ok(respostasDe(c, x)[0]?.naColecao === false && !respostasDe(c, x)[0]?.recusado, 'e volta ao Depot');
    ok(await ate(() => !c.colecao().includes(x)), 'e sai da lista da tela');

    // Um OUTRO pokémon não herda a espera do primeiro.
    c.limpar();
    const y = conta.depot[1];
    c.rajada(mover(y, 'colecao'));
    ok(await ate(() => respostasDe(c, y)[0]?.naColecao === true), 'a espera é por pokémon: outro entra na hora');

    // Um pokémon da EQUIPE também pode ser marcado — e continua na equipe.
    c.limpar();
    c.rajada(mover(conta.segundo, 'colecao'));
    ok(await ate(() => respostasDe(c, conta.segundo)[0]?.naColecao === true), 'um da equipe também entra na Coleção');
    ok((c.estado.pokemons ?? []).find((k) => k.id === conta.segundo)?.slot != null, 'e continua na equipe');

    ok(JSON.stringify(await linhasDe(conta.playerId)) === JSON.stringify(antes), 'o banco tem exatamente as mesmas linhas');
    ok(JSON.stringify(await colecaoNoBanco(conta.playerId, [y, conta.segundo])) === JSON.stringify([y, conta.segundo].sort((a, b) => a - b)),
      'e a lista gravada no banco bate com a memória');
    const { rows: log } = await pool.query(
      `SELECT acao FROM player_gameplay_log WHERE player_id = $1 AND categoria = 'colecao' ORDER BY id`, [conta.playerId],
    );
    ok(log.map((l) => l.acao).join(',') === 'entrou,saiu,entrou,entrou', 'a auditoria registra só as trocas de verdade',
      log.map((l) => l.acao).join(','));
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('2. Pacotes tortos: destino inventado, lixo no id, pokémon de outra conta');
  {
    const conta = await criarConta('b', { depot: 3 });
    const outra = await criarConta('b2', { depot: 2 });
    const c = await entrar(conta);
    const [x] = conta.depot;
    const alheio = outra.depot[0];
    const antes = await linhasDe(conta.playerId);
    const antesOutra = await linhasDe(outra.playerId);

    const tortos = [
      mover(x, 'lixeira'), mover(x, ''), mover(x, null), mover(x, ['colecao']), { t: 'colecao.mover', pokemonId: x },
      mover('abc', 'colecao'), mover(-5, 'colecao'), mover(0, 'colecao'), mover(1.5, 'colecao'),
      mover(1e30, 'colecao'), mover({ id: x }, 'colecao'), mover([x], 'colecao'), mover(null, 'colecao'),
      mover('__proto__', 'colecao'), { t: 'colecao.mover', pokemonId: x, para: 'colecao', naColecao: false, recusado: false },
    ];
    c.rajada(...tortos.slice(0, 14));
    ok(await ate(() => c.avisos().length >= 14, 6000), 'os quatorze pacotes tortos respondem', `${c.avisos().length}`);
    ok(c.avisos().filter((a) => a === 'colecao.pedidoInvalido').length === 14, 'todos como pedido inválido',
      c.avisos().join(' | '));
    ok(!c.colecao().includes(x), 'e nenhum mexeu no pokémon');
    // O último é honesto no destino, com campos de RESPOSTA forjados — que o servidor ignora.
    c.limpar();
    c.rajada(tortos[14]);
    ok(await ate(() => respostasDe(c, x).length === 1), 'campos de resposta forjados não atrapalham');
    ok(respostasDe(c, x)[0]?.naColecao === true, 'o pedido vale pelo destino, não pelo que o cliente diz do resultado');

    c.limpar();
    c.rajada(mover(alheio, 'colecao'), mover(String(alheio), 'colecao'));
    ok(await ate(() => c.avisos().filter((a) => a === 'colecao.naoTem').length === 2), 'o pokémon de OUTRA conta é recusado', c.avisos().join(' | '));
    ok(respostasDe(c, alheio).every((e) => e.recusado && e.naColecao === false), 'e a resposta diz que ele não está na Coleção');
    ok(!c.colecao().includes(alheio), 'o id alheio não entra na lista');
    ok(JSON.stringify(await colecaoNoBanco(outra.playerId)) === '[]', 'nem na lista da outra conta');

    ok(JSON.stringify(await linhasDe(conta.playerId)) === JSON.stringify(antes), 'nenhuma linha desta conta mudou');
    ok(JSON.stringify(await linhasDe(outra.playerId)) === JSON.stringify(antesOutra), 'nenhuma linha da outra conta mudou');
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('3. A venda ao NPC respeita a Coleção');
  {
    const conta = await criarConta('c', { depot: 6, colecao: [0, 1] });
    const c = await entrar(conta);
    const [x, y, livre1, livre2, livre3, livre4] = conta.depot;
    ok(c.colecao().includes(x) && c.colecao().includes(y), 'os dois nasceram na Coleção');

    const ouro0 = c.ouro();
    c.rajada(vender(x));
    ok(await ate(() => c.avisos().includes('colecao.travaVenda')), 'vender um da Coleção é recusado', c.avisos().join(' | '));
    await dormir(400);
    ok(c.ouro() === ouro0, 'e não paga nada');
    ok((await linhasDe(conta.playerId)).includes(x), 'e ele continua no banco');

    // Um preço de referência: um livre, igual aos outros.
    c.limpar();
    c.rajada(vender(livre1));
    ok(await ate(() => c.de('venda').length === 1), 'um livre vende');
    const preco = c.de('venda')[0].ganho;
    ok(preco > 0, `e rende ${preco}`);

    // O lote: só os de fora da Coleção. O ouro da tela chega no pacote de estado (que tem trava de
    // 500 ms), então primeiro ele alcança a venda de referência.
    ok(await ate(() => c.ouro() === ouro0 + preco), 'o ouro da tela alcança a venda de referência');
    c.limpar();
    const ouro1 = c.ouro();
    c.rajada({ t: 'shop.sellAllPokemons' });
    ok(await ate(() => c.de('venda').length === 1), 'o "vender todo o depot" responde');
    ok(c.de('venda')[0].qtd === 3, 'e vende só os três de fora da Coleção', JSON.stringify(c.de('venda')[0]));
    ok(c.de('venda')[0].ganho === 3 * preco, 'pagando três, e não cinco', JSON.stringify(c.de('venda')[0]));
    ok(await ate(() => c.ouro() === ouro1 + 3 * preco), 'e o ouro da tela sobe exatamente isso', `${c.ouro() - ouro1}`);
    const linhas = await linhasDe(conta.playerId);
    ok(linhas.includes(x) && linhas.includes(y), 'os dois da Coleção ficaram');
    ok(![livre2, livre3, livre4].some((id) => linhas.includes(id)), 'os três livres saíram');

    // Sem nada fora da Coleção, o lote não vende nada.
    c.limpar();
    c.rajada({ t: 'shop.sellAllPokemons' });
    ok(await ate(() => c.avisos().includes('o depot está vazio')), 'só com a Coleção, o lote diz que não há o que vender', c.avisos().join(' | '));
    ok((await linhasDe(conta.playerId)).includes(x), 'e a Coleção continua inteira');
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('4. Corridas: mover e vender no mesmo instante');
  {
    const conta = await criarConta('d', { depot: 8, colecao: [0, 1, 2, 3] });
    const c = await entrar(conta);
    const [a, b, d, e, ref] = conta.depot;
    c.rajada(vender(ref));
    ok(await ate(() => c.de('venda').length === 1), 'venda de referência');
    const preco = c.de('venda')[0].ganho;

    // a: sai da Coleção, vende, tenta voltar, vende de novo — tudo no mesmo tique.
    c.limpar();
    const ouroA = c.ouro();
    c.rajada(mover(a, 'depot'), vender(a), mover(a, 'colecao'), vender(a));
    ok(await ate(() => c.de('venda').length + c.avisos().length >= 3 && respostasDe(c, a).length >= 2),
      'as quatro respostas chegam', JSON.stringify(c.eventos.map((x) => x.k + ':' + (x.msg ?? x.naColecao ?? ''))));
    ok(c.de('venda').length === 1, 'o pokémon é vendido UMA vez', `${c.de('venda').length}`);
    ok(await ate(() => c.ouro() === ouroA + preco), 'e paga UMA vez', `${c.ouro() - ouroA}`);
    ok(respostasDe(c, a).at(-1)?.recusado === true, 'mover depois da venda é recusado (ele não existe mais)');
    ok(c.avisos().includes('esse pokémon não está mais com você'), 'e vender de novo também');
    ok(!(await linhasDe(conta.playerId)).includes(a), 'a linha saiu do banco');
    ok(await ate(() => !c.colecao().includes(a)), 'e o id não volta para a Coleção');

    // b: vende ANTES de sair da Coleção — a venda é recusada, e só depois ele sai.
    c.limpar();
    const ouroB = c.ouro();
    c.rajada(vender(b), mover(b, 'depot'));
    ok(await ate(() => respostasDe(c, b).length === 1 && c.avisos().includes('colecao.travaVenda')), 'as respostas chegam na ordem da fila');
    ok(c.de('venda').length === 0 && c.ouro() === ouroB, 'a venda foi recusada: a marca valia quando ela rodou');
    ok((await linhasDe(conta.playerId)).includes(b), 'b continua no banco');
    ok(respostasDe(c, b)[0]?.naColecao === false, 'e depois saiu da Coleção');

    // d e e: o lote no meio. d sai antes do lote (entra nele); e sai depois (fica). O b, que saiu
    // da Coleção no passo anterior, também está no Depot agora e vai junto.
    c.limpar();
    c.rajada(mover(d, 'depot'), { t: 'shop.sellAllPokemons' }, mover(e, 'depot'));
    ok(await ate(() => c.de('venda').length === 1 && respostasDe(c, e).length === 1), 'lote e movers respondem');
    const lote = c.de('venda')[0];
    const linhas = await linhasDe(conta.playerId);
    ok(!linhas.includes(d), 'd saiu da Coleção antes do lote e foi vendido');
    ok(!linhas.includes(b), 'b, já no Depot, foi junto');
    ok(linhas.includes(e), 'e estava na Coleção quando o lote rodou: ficou');
    const livres = conta.depot.length - 5;
    ok(lote.qtd === 2 + livres && lote.ganho === (2 + livres) * preco,
      `o lote vendeu ${lote.qtd} (d, b e os ${livres} livres) e pagou por eles`, JSON.stringify(lote));

    // A rajada inteira de novo, agora contra o que sobrou: nada some duas vezes.
    const sobraram = await linhasDe(conta.playerId);
    c.limpar();
    c.rajada(...Array.from({ length: 8 }, () => vender(e)), ...Array.from({ length: 4 }, () => mover(e, 'colecao')));
    ok(await ate(() => c.de('venda').length + c.avisos().length >= 8), 'a rajada de oito vendas responde');
    ok(c.de('venda').length === 1, 'e só uma vende', `${c.de('venda').length}`);
    const depois = await linhasDe(conta.playerId);
    ok(depois.length === sobraram.length - 1 && !depois.includes(e), 'o banco perdeu exatamente um pokémon');
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('5. Os baldes por conta: a rajada de trocas');
  {
    // Quarenta no mesmo tique: quem corta primeiro é o limite GERAL do gateway (15 de rajada).
    const conta = await criarConta('e', { depot: 40 });
    const c = await entrar(conta);
    const antes = await linhasDe(conta.playerId);
    c.rajada(...conta.depot.map((id) => mover(id, 'colecao')));
    await ate(() => c.de('colecao').length >= 10, 8000);
    await dormir(1500);
    const aceitos = c.de('colecao').filter((e) => e.naColecao && !e.recusado).map((e) => Number(e.id));
    ok(aceitos.length >= 10 && aceitos.length < 40, `a rajada passa só até o limite (${aceitos.length} de 40)`);
    ok(c.erros.some((e) => /Devagar/i.test(String(e))), 'e o resto é recusado pelo gateway', c.erros.join(' | '));
    ok(await ate(() => aceitos.every((id) => c.colecao().includes(id))), 'todo aceito está na lista da tela');
    ok(new Set(c.colecao()).size === c.colecao().length, 'a lista não tem id repetido');
    ok(JSON.stringify(await linhasDe(conta.playerId)) === JSON.stringify(antes), 'e nenhuma linha foi criada ou apagada');
    await c.fechar();

    // Trinta espaçados em 50 ms (o geral repõe 20/s e aguenta): quem corta é o balde da Coleção,
    // de 20 de rajada e 2 por segundo.
    const conta2 = await criarConta('e2', { depot: 30 });
    const c2 = await entrar(conta2);
    for (const id of conta2.depot) {
      c2.rajada(mover(id, 'colecao'));
      await dormir(50);
    }
    await dormir(1500);
    const aceitos2 = c2.de('colecao').filter((e) => e.naColecao && !e.recusado).length;
    ok(aceitos2 >= 20 && aceitos2 <= 26, `o balde da Coleção deixa ~20 + a reposição (${aceitos2} de 30)`);
    ok(aceitos2 < 30 && c2.erros.some((e) => /Devagar/i.test(String(e))), 'e recusa o resto', c2.erros.join(' | '));
    ok(await ate(() => c2.colecao().length === aceitos2), 'a lista da tela tem exatamente os aceitos');
    await c2.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('6. O cadeado antigo (`shop.lockPokemon`) passa pela mesma regra');
  {
    const conta = await criarConta('f', { depot: 3 });
    const c = await entrar(conta);
    const [x] = conta.depot;
    c.rajada({ t: 'shop.lockPokemon', id: x });
    ok(await ate(() => respostasDe(c, x)[0]?.naColecao === true), 'alternar põe na Coleção');
    c.limpar();
    c.rajada({ t: 'shop.lockPokemon', id: x }, { t: 'shop.lockPokemon', id: x }, { t: 'shop.lockPokemon', id: x });
    ok(await ate(() => respostasDe(c, x).length === 3), 'três alternâncias no mesmo instante respondem');
    ok(respostasDe(c, x).every((e) => e.recusado && e.naColecao === true), 'e a espera recusa as três', JSON.stringify(respostasDe(c, x)));
    ok(c.colecao().includes(x), 'o pokémon não piscou para fora da Coleção');
    c.limpar();
    c.rajada({ t: 'shop.lockPokemon', id: conta.depot[1] + 999999 });
    await dormir(600);
    ok(!c.de('colecao').length && !c.avisos().length, 'alternar um id que não existe é ignorado em silêncio');
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('7. Relogin: a lista se limpa, e o anunciado continua na Coleção');
  {
    const conta = await criarConta('g', { depot: 4, colecao: [0, 1], lixo: [999999999, 'abc', -1, 0] });
    const outra = await criarConta('g2', { depot: 1 });
    // Um id de OUTRA conta gravado na lista (o pokémon vendido no Mercado deixa isso para trás).
    await pool.query(
      `UPDATE players SET automation = jsonb_set(automation, '{pokemonTravado}', (automation->'pokemonTravado') || $2::jsonb) WHERE id = $1`,
      [conta.playerId, JSON.stringify([outra.depot[0], String(conta.depot[1])])],
    );
    const [x, y] = conta.depot;
    // x é P5 (entra no Mercado em qualquer nota) e vai ser anunciado.
    await pool.query(`UPDATE player_pokemon SET potencia = 5 WHERE id = $1`, [x]);
    let c = await entrar(conta);
    ok(JSON.stringify([...c.colecao()].sort((a, b) => a - b)) === JSON.stringify([x, y].sort((a, b) => a - b)),
      'o login limpa o lixo, o id alheio e o repetido', JSON.stringify(c.colecao()));
    ok(JSON.stringify(await colecaoNoBanco(conta.playerId, [x, y])) === JSON.stringify([x, y].sort((a, b) => a - b)),
      'e grava a lista limpa no banco');

    c.limpar();
    c.rajada({ t: 'market.criar', tipo: 'pokemon', pokemonId: x, preco: 900000, moeda: 'gold', dias: 1 });
    ok(await ate(() => c.de('marketCriado').length === 1), 'um pokémon da Coleção pode ser anunciado',
      JSON.stringify(c.eventos.map((e) => e.k + ':' + (e.msg ?? ''))));
    ok(await ate(() => !c.naTela(x)), 'e sai da mão (vai para a vitrine)');
    ok(c.colecao().includes(x), 'mas continua marcado na Coleção');
    await c.fechar();
    await dormir(1500);

    c = await entrar(conta);
    ok(c.colecao().includes(x), 'relogando, o anunciado CONTINUA na Coleção');
    ok(!c.naTela(x), 'mesmo fora da mão');
    const { rows: meus } = await pool.query(
      `SELECT id FROM market_anuncios WHERE pokemon_id = $1 AND estado = 'aberto'`, [x],
    );
    c.limpar();
    c.rajada({ t: 'market.cancelar', id: Number(meus[0].id) });
    ok(await ate(() => c.naTela(x), 6000), 'cancelado o anúncio, ele volta');
    ok(c.colecao().includes(x), 'e volta direto para a Coleção');
    c.limpar();
    c.rajada(vender(x));
    ok(await ate(() => c.avisos().includes('colecao.travaVenda')), 'e continua fora da venda ao NPC');
    await c.fechar();
  }

  // ---------------------------------------------------------------------------------------
  secao('8. A Oferenda aceita a Coleção, e o id sai da lista depois do giro');
  {
    const conta = await criarConta('h', { depot: 7, colecao: [0] });
    const c = await entrar(conta);
    const [x, y] = conta.depot;
    c.rajada({ t: 'oferenda.girar', pokemonIds: [x, y] });
    ok(await ate(() => c.de('oferenda').length === 1), 'o giro com um pokémon da Coleção acontece',
      c.avisos().join(' | '));
    const linhas = await linhasDe(conta.playerId);
    ok(!linhas.includes(x) && !linhas.includes(y), 'os dois saíram do banco');
    ok(await ate(() => !c.colecao().includes(x)), 'e o id queimado sai da Coleção');
    c.limpar();
    c.rajada(mover(x, 'colecao'));
    ok(await ate(() => c.avisos().includes('colecao.naoTem')), 'marcar o queimado de novo é recusado');
    ok(!c.colecao().includes(x), 'e ele não volta para a lista');
    await c.fechar();
  }
} catch (err) {
  falhas++;
  console.log(`\n✗ o teste parou: ${err.stack ?? err.message}`);
} finally {
  await apagarContas();
  await pool.end().catch(() => {});
}

console.log(`\n${testes - falhas}/${testes} ${falhas ? `— ${falhas} FALHA(S)` : 'ok'}`);
process.exit(falhas ? 1 : 0);
