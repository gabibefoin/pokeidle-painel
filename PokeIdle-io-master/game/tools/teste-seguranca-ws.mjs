// Mensagens INTERNAS do barramento não podem ser mandadas pelo cliente.
//
//     node tools/teste-seguranca-ws.mjs [http://localhost:8080]
//
// Precisa de um servidor de pé (gateway + sim) apontando para o MESMO Postgres do `.env`. Cria
// três contas descartáveis, tenta os ataques pelo socket, confere o resultado no BANCO e apaga
// tudo no fim.
//
// ### O buraco que isto protege
//
// O gateway repassa ao sim todo pacote que não é de chat como `{ ...msg, playerId }`, e o sim
// trata no MESMO canal as mensagens que só o servidor manda: `entrar` (com `nick` e `admin`),
// `admin.gold`, `admin.items`, `admin.diamantes`, `admin.gemas`, `admin.ban`, as da migração da
// Arena PvP e `amigos.sync`. Sem a separação, um jogador com DevTools:
//
//   · se dava ouro e itens (os dois vão para o banco no flush);
//   · punha a própria linha fora da memória sem gravar (`admin.ban`) e, em seguida, pedia
//     `entrar` com o nick de OUTRA pessoa — o sim carregava a conta dela sob a chave do
//     atacante, e o gateway entregava a tela no socket dele. Tomada de conta sem senha.
//
// O teste também confere o outro lado: um comando legítimo continua chegando ao sim.
import WebSocket from 'ws';
import { criarConta, assinarSessao } from '../src/server/auth.mjs';
import { pool } from '../src/server/db.mjs';

const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const WS_URL = ORIGEM.replace(/^http/, 'ws');
const SUFIXO = Date.now().toString(36).slice(-6);
const ITEM_TESTE = 40530;

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const criadas = [];
async function novaConta(nick) {
  const c = await criarConta({ nick, email: `${nick}@gmail.com`, senha: 'teste1234' });
  const { rows } = await pool.query(
    `UPDATE accounts SET nick = $2, nick_ok = true, email_ok = true WHERE id = $1 RETURNING *`,
    [c.id, nick],
  );
  criadas.push(nick);
  const conta = rows[0];
  return {
    nick: conta.nick,
    token: await assinarSessao({ nick: conta.nick, contaId: Number(conta.id), provedor: conta.provedor }),
  };
}

/** Um socket logado. `texto` junta tudo o que chegou, para procurar por nick sem depender do formato. */
function conectar({ token }) {
  return new Promise((resolver, rejeitar) => {
    const ws = new WebSocket(WS_URL);
    const recebidas = [];
    const s = { ws, recebidas, texto: () => recebidas.join('\n'), mandar: (m) => ws.send(JSON.stringify(m)) };
    const prazo = setTimeout(() => rejeitar(new Error('sem welcome em 20 s')), 20_000);
    ws.on('message', (raw) => {
      const txt = raw.toString();
      recebidas.push(txt);
      if (txt.includes('"t":"welcome"')) {
        clearTimeout(prazo);
        resolver(s);
      }
    });
    ws.on('open', () => s.mandar({ t: 'hello', token }));
    ws.on('error', rejeitar);
  });
}

const linha = async (nick) => (await pool.query(
  `SELECT id, gold, items, diamonds, orbs, tutorial_visto FROM players WHERE lower(nick) = lower($1)`,
  [nick],
)).rows[0];

async function limpar() {
  if (!criadas.length) return;
  const nicks = criadas.map((n) => n.toLowerCase());
  const { rows } = await pool.query(`SELECT id FROM players WHERE lower(nick) = ANY($1::text[])`, [nicks]);
  const ids = rows.map((r) => Number(r.id));
  if (ids.length) {
    // A guild só existe se a versão testada ainda cobrava do ouro velho do banco.
    await pool.query(`DELETE FROM guild_members WHERE guild_id IN (SELECT id FROM guilds WHERE owner_id = ANY($1::bigint[]))`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM guild_members WHERE player_id = ANY($1::bigint[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM guilds WHERE owner_id = ANY($1::bigint[])`, [ids]).catch(() => {});
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

console.log(`SEGURANÇA DO SOCKET — mensagens internas\n========================================\n${ORIGEM}`);

try {
  const saude = await (await fetch(`${ORIGEM}/saude`)).json();
  const gatewayId = saude.gatewayId;
  ok(!!gatewayId, 'o /saude responde com o gatewayId (é público — o atacante também o tem)');

  // Dois sockets que nunca entram no jogo: um calado, outro com sessão inválida. A conferência é
  // no fim, quando já passaram os 30 s do gateway.
  const socketCru = () => {
    const s = { ws: new WebSocket(WS_URL), fechou: null, recebidas: [] };
    s.ws.on('message', (raw) => s.recebidas.push(raw.toString()));
    s.ws.on('close', (code) => { s.fechou = code; });
    s.ws.on('error', () => {});
    return s;
  };
  const mudo = socketCru();
  const recusado = socketCru();
  recusado.ws.on('open', () => recusado.ws.send(JSON.stringify({ t: 'hello', token: 'x.y' })));
  const inicioMudo = Date.now();

  const vitima = await novaConta(`secv${SUFIXO}`);
  const atacante = await novaConta(`seca${SUFIXO}`);

  // A vítima entra uma vez (a linha de `players` nasce) e sai.
  const sv = await conectar(vitima);
  sv.ws.close();
  await esperar(1500);

  const sa = await conectar(atacante);
  await esperar(800);
  const antesA = await linha(atacante.nick);
  const antesV = await linha(vitima.nick);
  ok(!!antesA && !!antesV, 'as duas contas têm linha em players');

  console.log('\nDinheiro e itens pelo socket');
  sa.mandar({ t: 'admin.gold', gold: 987654321 });
  sa.mandar({ t: 'admin.items', items: { [ITEM_TESTE]: 7 } });
  sa.mandar({ t: 'admin.diamantes', saldo: 55555, qtd: 55555 });
  sa.mandar({ t: 'admin.gemas', saldo: 44444 });
  // Tentativas de contornar a própria correção: apagar o carimbo, carimbo em texto, caixa trocada.
  sa.mandar({ t: 'admin.gold', gold: 987654321, doCliente: false });
  sa.mandar({ t: 'admin.gold', gold: 987654321, doCliente: 'false' });
  sa.mandar({ t: 'Admin.Gold', gold: 987654321 });
  sa.mandar({ t: 'admin.items ', items: { [ITEM_TESTE]: 7 } });
  // O controle: um comando legítimo tem de continuar chegando ao sim e indo para o banco.
  sa.mandar({ t: 'tutorial.concluir' });
  await esperar(7000);
  const depoisA = await linha(atacante.nick);
  ok(Number(depoisA.gold) === Number(antesA.gold), 'admin.gold do cliente não muda o ouro', `${antesA.gold} → ${depoisA.gold}`);
  ok(
    Number(depoisA.items?.[ITEM_TESTE] ?? 0) === Number(antesA.items?.[ITEM_TESTE] ?? 0),
    'admin.items do cliente não dá item',
    `${antesA.items?.[ITEM_TESTE] ?? 0} → ${depoisA.items?.[ITEM_TESTE] ?? 0}`,
  );
  ok(!/55555|44444/.test(sa.texto()), 'admin.diamantes/admin.gemas do cliente não trocam o saldo da tela');
  ok(depoisA.tutorial_visto === true, 'um comando legítimo (tutorial.concluir) continua chegando ao sim');

  // O ouro de quem está online só vai ao banco no flush: entre dois flushes o banco tem um
  // número VELHO. A criação de guild cobrava desse número e copiava o resultado para a memória —
  // gastar e criar a guild antes do flush devolvia o gasto. Aqui o banco fica com mais ouro do que
  // a memória (o jogador "gastou" e o flush ainda não passou) e o custo tem de sair da memória.
  console.log('\nGuild com o ouro do banco atrasado');
  await pool.query(`UPDATE players SET gold = 5000000 WHERE id = $1`, [antesA.id]);
  const antesDaGuild = sa.recebidas.length;
  sa.mandar({ t: 'guild.criar', nome: `Sec${SUFIXO}`, brasao: {} });
  await esperar(3000);
  const membro = await pool.query(`SELECT 1 FROM guild_members WHERE player_id = $1`, [antesA.id]);
  ok(membro.rowCount === 0, 'sem o ouro na memória, a guild não nasce do ouro velho do banco');
  ok(
    sa.recebidas.slice(antesDaGuild).some((m) => m.includes('Precisa de')),
    'o jogador recebe o mesmo aviso de ouro insuficiente de sempre',
  );
  await pool.query(`UPDATE players SET gold = $2 WHERE id = $1`, [antesA.id, antesA.gold]);

  console.log('\nTomada de conta');
  const antesDoAtaque = sa.recebidas.length;
  sa.mandar({ t: 'admin.ban' });
  sa.mandar({ t: 'sair' });
  await esperar(1500);
  sa.mandar({ t: 'entrar', nick: vitima.nick, gatewayId, admin: true, chatCargo: 'admin', delta: false });
  sa.mandar({ t: 'pvp.retornouDoRemoto', nick: vitima.nick, gatewayId, admin: true });
  sa.mandar({ t: 'pvp.entrarRemoto', nick: vitima.nick, gatewayId, admin: true, arenaId: 0, homeShard: 0 });
  await esperar(4000);
  const depois = sa.recebidas.slice(antesDoAtaque).join('\n');
  ok(!depois.toLowerCase().includes(vitima.nick.toLowerCase()), 'entrar com o nick de outra pessoa não entrega a conta dela', 'o socket do atacante recebeu dados da vítima');
  ok(!/"admin":true/.test(depois), 'entrar forjado não liga o admin');

  console.log('\nTipos esquisitos');
  for (const t of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'amigos.sync', 'pvp.limparEmigrado', 'pvp.rank.mudou']) {
    sa.mandar({ t, alvoNick: vitima.nick, coletarCoins: true, playerId: vitima.nick.toLowerCase() });
  }
  sa.mandar({ t: 'ping' });
  await esperar(1500);
  ok(sa.recebidas.slice(-5).some((m) => m.includes('"t":"pong"')), 'o socket segue vivo depois de tipos estranhos');

  // O jogador legítimo ainda está inteiro: o atacante não o tirou da memória sem gravar.
  sa.mandar({ t: 'tutorial.concluir' });
  await esperar(500);
  const depoisV = await linha(vitima.nick);
  ok(Number(depoisV.gold) === Number(antesV.gold), 'a linha da vítima continua como estava');

  console.log('\nSocket que não se apresenta');
  await esperar(Math.max(0, inicioMudo + 33_000 - Date.now()));
  ok(mudo.fechou === 4002, 'socket aberto sem hello é fechado em 30 s', `close=${mudo.fechou}`);
  ok(
    recusado.fechou === null && recusado.recebidas.some((m) => m.includes('sessaoInvalida')),
    'sessão recusada continua aberta, como antes (quem decide é o cliente)',
    `close=${recusado.fechou}`,
  );
  recusado.ws.close();

  sa.ws.close();
} catch (err) {
  falhas++;
  console.log(`  ✗ o teste estourou: ${err.message}`);
} finally {
  await esperar(1500);
  await limpar().catch((err) => console.log(`  (limpeza falhou: ${err.message})`));
  await pool.end();
}

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
