// O `/resgatar` PELO SOCKET — do comando do chat até o prêmio na conta.
//
// O irmão de `teste-convites.mjs`: aquele prova a regra e a corrida NO BANCO, sem o jogo de pé;
// este prova o caminho inteiro, com o servidor ligado. O que ele protege:
//
//   · **o prêmio entra de verdade**: diamante, Beast Ball, boost e VIP aparecem no estado que o
//     cliente recebe, e o diamante aparece no ledger com motivo `convite`;
//   · **o VIP permanente**: o marco de 500 grava um `vipAte` que nunca vence;
//   · **a recusa**: código malformado, código inexistente e código já gasto voltam a chave de
//     texto certa — e nenhum deles credita nada;
//   · **A CORRIDA AO VIVO**: duas contas logadas disparam o MESMO código no mesmo instante, cada
//     uma no seu socket. Uma leva; a outra recebe "já foi resgatado"; o ledger tem uma linha;
//   · **o anti-força-bruta**: a segunda tentativa em menos de 3 s é barrada antes do banco;
//   · **o anúncio no chat mundo**: quem resgata aparece para TODO MUNDO, nos três idiomas, com
//     o marco dentro da linha — e a reentrega de um código já gasto NÃO anuncia de novo.
//
// Precisa do servidor de pé:
//
//   npm start
//   node tools/teste-convites-socket.mjs
import { WebSocket } from 'ws';
import { sessaoDe } from './sessao-local.mjs';
import { helloCom } from './auth-teste.mjs';
import { pool } from '../src/server/db.mjs';
import * as convdb from '../src/server/convites-db.mjs';
import { MARCOS, VIP_PERMANENTE_ATE, marcoDe } from '../src/shared/convites.mjs';

const URL = process.env.WS_URL ?? 'ws://localhost:8080';
const MARCA = `cvs${Date.now().toString(36).slice(-6)}`;
const DISCORD = `${MARCA}-padrinho`;

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

const criadas = [];

/**
 * Fecha um socket e espera o gateway soltar a vaga.
 *
 * `MAX_ONLINE_POR_IP` e 4 no `.env` padrao, e este teste abre seis contas. Deixar todas ligadas
 * ate o fim faz o gateway recusar a quinta (`ja tem 4/4 on-line`) e o `welcome` nunca chegar —
 * o teste ficava pendurado para sempre. Cada secao devolve a vaga que usou.
 */
async function desligar(...cs) {
  for (const c of cs) c?.ws?.close();
  await dormir(900);
}

/** Uma conta descartável, pronta para logar (nível 10 para o chat não travar). */
async function criarConta(sufixo) {
  const nick = `${MARCA}${sufixo}`;
  criadas.push(nick);
  await pool.query(
    `INSERT INTO accounts (nick, email, provedor, email_ok) VALUES ($1, $2, 'local', true)`,
    [nick, `${nick}@test.local`],
  );
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, visual_ok, tutorial_visto, discord_pop_campanha, aviso_visto)
     VALUES ($1, 50, true, true, 99, 99) RETURNING id`,
    [nick],
  );
  return { nick, id: Number(rows[0].id) };
}

/** Liga um socket já autenticado e devolve o que ele recebeu de `convite` e de `estado`. */
async function conectar(conta) {
  const c = { ws: new WebSocket(URL), convites: [], estados: [], avisos: [], chats: [] };
  await new Promise((resolve, reject) => {
    // Sem este relógio, um `welcome` que não chega pendura o teste PARA SEMPRE, sem dizer por
    // quê. E ele não chega em dois casos reais: o gateway recusou a conexão por
    // `MAX_ONLINE_POR_IP` (a mensagem sai no log DELE, não aqui) ou o servidor não está de pé.
    const rel = setTimeout(
      () => reject(new Error(`sem welcome para ${conta.nick} em 15 s — servidor de pe? MAX_ONLINE_POR_IP cheio?`)),
      15_000,
    );
    const pronto = () => { clearTimeout(rel); resolve(); };
    c.ws.on('open', async () => c.ws.send(JSON.stringify(helloCom(await sessaoDe(conta.nick)))));
    c.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') pronto();
      if (m.t === 'convite') c.convites.push(m);
      if (m.t === 'estado') c.estados.push(m);
      if (m.t === 'chat') c.chats.push(m);
      // Os avisos do sim viajam em LOTE, dentro de `batalha.ev` (ver `SERVIDOR.BATALHA`) — e
      // nao como mensagem propria. Foi o que fez a primeira versao deste teste nao achar o
      // `convite.espera` do anti-forca-bruta.
      if (m.t === 'batalha') {
        for (const ev of m.ev ?? []) if (ev.k === 'aviso') c.avisos.push(ev);
      }
    });
    c.ws.on('error', (err) => { clearTimeout(rel); reject(err); });
  });
  c.enviar = (o) => c.ws.send(JSON.stringify(o));
  c.esperar = async (cond, ms = 8000) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      const achado = c.convites.find(cond);
      if (achado) return achado;
      await dormir(80);
    }
    return null;
  };
  return c;
}

async function limpar() {
  await pool.query(
    `DELETE FROM chat_publico_mensagens WHERE extra->'conviteResgate'->>'nick' LIKE $1`,
    [`${MARCA}%`],
  ).catch(() => {});
  await pool.query(`DELETE FROM convite_codigos WHERE discord_id LIKE $1`, [`${MARCA}%`]);
  await pool.query(`DELETE FROM convite_membros WHERE discord_id LIKE $1 OR padrinho_id LIKE $1`, [`${MARCA}%`]);
  for (const nick of criadas) {
    const { rows } = await pool.query(`SELECT id FROM players WHERE lower(nick) = lower($1)`, [nick]);
    const id = rows[0]?.id;
    if (id) {
      await pool.query(`DELETE FROM convite_codigos WHERE player_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM diamante_ledger WHERE player_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM player_gameplay_log WHERE player_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM player_pokemon WHERE player_id = $1`, [id]).catch(() => {});
    }
    await pool.query(`DELETE FROM accounts WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
  }
}

/** Gera um código de um marco direto no banco, como o bot faria. */
const codigoDe = async (marco) => (await convdb.gerarCodigo(DISCORD, marco, marco)).codigo;

console.log('CONVITES PELO SOCKET\n====================');
const sockets = [];
try {
  await convdb.migrar();
  await limpar();

  // ------------------------------------------------------------ o prêmio entra
  secao('O prêmio entra na conta');
  {
    const conta = await criarConta('a');
    const c = await conectar(conta);
    sockets.push(c);

    const cod1 = await codigoDe(1); // 5 💎
    c.enviar({ t: 'convite.resgatar', codigo: cod1 });
    const r1 = await c.esperar((m) => m.marco != null || m.recusa);
    ok(r1?.marco === 1, 'o marco de 1 convidado é resgatado', JSON.stringify(r1?.recusa ?? ''));
    ok(r1?.premios?.[0]?.tipo === 'diamante' && r1.premios[0].qtd === 5, 'e devolve os 5 diamantes');

    const { rows: led } = await pool.query(
      `SELECT delta, motivo, ref FROM diamante_ledger WHERE player_id = $1`, [conta.id],
    );
    ok(led.length === 1 && Number(led[0].delta) === 5 && led[0].motivo === 'convite',
      'o ledger registra o crédito com motivo "convite"', JSON.stringify(led));
    ok(led[0]?.ref === cod1, 'e guarda o código como referência');

    const { rows: saldo } = await pool.query(`SELECT diamonds FROM players WHERE id = $1`, [conta.id]);
    ok(Number(saldo[0].diamonds) === 5, 'e o saldo do jogador subiu', JSON.stringify(saldo[0]));

    // O carimbo de ENTREGA: o sim força o flush e só então marca.
    await dormir(600);
    const { rows: carimbo } = await pool.query(
      `SELECT resgatado_em, entregue_em FROM convite_codigos WHERE codigo = $1`, [cod1],
    );
    ok(carimbo[0]?.resgatado_em && carimbo[0]?.entregue_em,
      'o código fica carimbado como resgatado E entregue', JSON.stringify(carimbo[0]));

    // Um marco de JOGO: bolas, boosts e VIP, que passam pela memória do sim.
    const cod100 = await codigoDe(100);
    c.convites.length = 0;
    await dormir(3200); // o anti-força-bruta é de 3 s
    c.enviar({ t: 'convite.resgatar', codigo: cod100 });
    const r100 = await c.esperar((m) => m.marco != null || m.recusa);
    ok(r100?.marco === 100, 'o marco de 100 convidados é resgatado', JSON.stringify(r100?.recusa ?? ''));
    await dormir(800);
    const { rows: p } = await pool.query(
      `SELECT balls, boosts, vip_ate FROM players WHERE id = $1`, [conta.id],
    );
    const balls = typeof p[0].balls === 'string' ? JSON.parse(p[0].balls) : p[0].balls;
    const boosts = typeof p[0].boosts === 'string' ? JSON.parse(p[0].boosts) : p[0].boosts;
    ok(Number(balls?.[5]) === 5000, '5.000 Beast Balls na bolsa', JSON.stringify(balls));
    const agora = Date.now();
    const horas = (k) => Math.round(((boosts?.[k] ?? 0) - agora) / 3_600_000);
    ok(horas('shiny') === 168 && horas('captura') === 168, 'sete dias de Secret Shiny e de Catch',
      JSON.stringify({ shiny: horas('shiny'), captura: horas('captura') }));
    ok(horas('xp') === 168 && horas('pokexp') === 168, 'sete dias de XP de treinador e de pokémon',
      JSON.stringify({ xp: horas('xp'), pokexp: horas('pokexp') }));
    const dias = Math.round((Number(p[0].vip_ate) - agora) / 86_400_000);
    ok(dias === 90, '90 dias de VIP', `${dias} dia(s)`);
    await desligar(c);
  }

  // --------------------------------------------------------- o VIP permanente
  secao('O marco de 500: VIP que não vence');
  {
    const conta = await criarConta('b');
    const c = await conectar(conta);
    sockets.push(c);
    const cod500 = await codigoDe(500);
    c.enviar({ t: 'convite.resgatar', codigo: cod500 });
    const r = await c.esperar((m) => m.marco != null || m.recusa);
    ok(r?.marco === 500, 'o marco de 500 é resgatado', JSON.stringify(r?.recusa ?? ''));
    await dormir(800);
    const { rows: p } = await pool.query(
      `SELECT balls, boosts, vip_ate FROM players WHERE id = $1`, [conta.id],
    );
    ok(Number(p[0].vip_ate) === VIP_PERMANENTE_ATE, 'o VIP ficou no instante permanente',
      new Date(Number(p[0].vip_ate)).toISOString());
    const balls = typeof p[0].balls === 'string' ? JSON.parse(p[0].balls) : p[0].balls;
    ok(Number(balls?.[5]) === 10_000, '10.000 Beast Balls na bolsa', JSON.stringify(balls));
    const boosts = typeof p[0].boosts === 'string' ? JSON.parse(p[0].boosts) : p[0].boosts;
    const cinco = ['xp', 'pokexp', 'loot', 'captura', 'shiny']
      .every((k) => Math.round(((boosts?.[k] ?? 0) - Date.now()) / 86_400_000) === 30);
    ok(cinco, 'um mês de TODOS os cinco boosts', JSON.stringify(boosts));
    await desligar(c);
  }

  // ------------------------------------------------------------- as recusas
  secao('As recusas');
  {
    const conta = await criarConta('c');
    const c = await conectar(conta);
    sockets.push(c);

    c.enviar({ t: 'convite.resgatar', codigo: 'NAOEXISTE' });
    ok((await c.esperar((m) => m.recusa))?.recusa === 'convite.invalido',
      'código com 9 letras é inválido');

    await dormir(3200);
    c.convites.length = 0;
    c.enviar({ t: 'convite.resgatar', codigo: 'ABCDEFGHJK' });
    ok((await c.esperar((m) => m.recusa))?.recusa === 'convite.invalido',
      'código bem formado que não existe é inválido');

    // Sem esperar os 3 s: o balde barra antes de chegar ao banco.
    c.convites.length = 0;
    c.avisos.length = 0;
    c.enviar({ t: 'convite.resgatar', codigo: 'ABCDEFGHJK' });
    await dormir(700);
    ok(c.convites.length === 0 && c.avisos.some((a) => a.msg === 'convite.espera'),
      'a segunda tentativa em menos de 3 s é barrada', JSON.stringify(c.avisos.map((a) => a.msg)));

    const { rows: led } = await pool.query(
      `SELECT count(*)::int AS n FROM diamante_ledger WHERE player_id = $1`, [conta.id],
    );
    ok(led[0].n === 0, 'nenhuma recusa creditou nada');
    await desligar(c);
  }

  // ---------------------------------------------------------------- A CORRIDA
  //
  // Duas contas LOGADAS, dois sockets, o mesmo código, no mesmo instante. É a prova de ponta a
  // ponta do que `teste-convites.mjs` prova no banco.
  secao('A CORRIDA: duas contas logadas, o mesmo código');
  {
    const c1 = await conectar(await criarConta('d'));
    const c2 = await conectar(await criarConta('e'));
    sockets.push(c1, c2);
    const cod = await codigoDe(5); // 10 💎

    // Sem `await` entre os dois `send`: os dois pacotes saem no mesmo laço de eventos.
    c1.enviar({ t: 'convite.resgatar', codigo: cod });
    c2.enviar({ t: 'convite.resgatar', codigo: cod });

    const r1 = await c1.esperar((m) => m.marco != null || m.recusa);
    const r2 = await c2.esperar((m) => m.marco != null || m.recusa);
    const ganhou = [r1, r2].filter((r) => r?.marco === 5);
    const perdeu = [r1, r2].filter((r) => r?.recusa === 'convite.usado');
    ok(ganhou.length === 1, 'exatamente UM socket leva o prêmio',
      JSON.stringify([r1?.marco ?? r1?.recusa, r2?.marco ?? r2?.recusa]));
    ok(perdeu.length === 1, 'o outro recebe "já foi resgatado"',
      JSON.stringify([r1?.recusa, r2?.recusa]));

    const { rows: led } = await pool.query(
      `SELECT player_id, delta FROM diamante_ledger WHERE motivo = 'convite' AND ref = $1`, [cod],
    );
    ok(led.length === 1 && Number(led[0].delta) === 10,
      'o ledger tem UMA linha de 10 diamantes', JSON.stringify(led));
    await desligar(c1, c2);
  }

  // ---------------------------------------------------------- a escada inteira
  secao('Todo marco da escada resgata');
  {
    const conta = await criarConta('f');
    const c = await conectar(conta);
    sockets.push(c);
    let feitos = 0;
    for (const m of MARCOS) {
      if (m.amigos === 1 || m.amigos === 5 || m.amigos === 100 || m.amigos === 500) continue;
      const cod = (await convdb.gerarCodigo(`${DISCORD}-${m.amigos}`, m.amigos, m.amigos)).codigo;
      c.convites.length = 0;
      c.enviar({ t: 'convite.resgatar', codigo: cod });
      const r = await c.esperar((x) => x.marco != null || x.recusa);
      if (r?.marco === m.amigos) feitos++;
      else console.log(`    (marco ${m.amigos} recusou: ${r?.recusa})`);
      await dormir(3200);
    }
    ok(feitos === 3, 'os marcos de 10, 20 e 50 resgatam', `${feitos}/3`);
    ok(marcoDe(10).premios.every((p) => p.tipo === 'boost'), 'e o de 10 é só boost, como a tabela diz');
    await desligar(c);
  }

  // ------------------------------------------------- o anúncio no chat mundo
  //
  // A linha do chat é a ÚNICA propaganda do programa dentro do jogo: quem nunca ouviu falar
  // descobre que existe vendo alguém ganhar. Por isso ela é testada de fora — pelo socket de
  // OUTRO jogador, que é quem precisa enxergar.
  secao('O anúncio no chat mundo');
  {
    const dono = await criarConta('g');
    const vizinho = await criarConta('h');
    const cDono = await conectar(dono);
    const cViz = await conectar(vizinho);
    sockets.push(cDono, cViz);

    const cod = await codigoDe(20); // dois boosts — o marco que exercita o "+N" na frase
    cViz.chats.length = 0;
    cDono.enviar({ t: 'convite.resgatar', codigo: cod });
    await cDono.esperar((m) => m.marco != null || m.recusa);
    await dormir(600);

    const linhas = cViz.chats.filter((m) => m.conviteResgate);
    ok(linhas.length > 0, 'o vizinho recebe a linha do resgate', JSON.stringify(cViz.chats.slice(-3)));
    // Uma por idioma: a frase é montada na tela de cada um, e o filtro de idioma é do cliente.
    ok(new Set(linhas.map((m) => m.idioma)).size === 3,
      'uma linha por idioma', linhas.map((m) => m.idioma).join(','));
    const l = linhas[0];
    ok(l?.conviteResgate?.nick === dono.nick && l?.conviteResgate?.marco === 20,
      'com o nick de quem resgatou e o marco', JSON.stringify(l?.conviteResgate));
    ok(l?.canal === 'mundo' && l?.cargo === 'anuncio',
      'no canal mundo, como anúncio', `${l?.canal}/${l?.cargo}`);

    // Sem isto a linha aparece na hora e desaparece do histórico: `chavesExtra`, em
    // `chat-db.mjs`, é uma lista fechada, e o que não está nela não é gravado.
    const { rows: hist } = await pool.query(
      `SELECT extra FROM chat_publico_mensagens WHERE extra->'conviteResgate'->>'nick' = $1`,
      [dono.nick],
    );
    ok(hist.length === 3, 'e fica no histórico persistido, nos três idiomas', `${hist.length} linha(s)`);

    // A REENTREGA é a mesma conquista chegando duas vezes (o login que refaz uma entrega que o
    // flush perdeu). Anunciar de novo seria festejar um marco que ninguém cruzou hoje.
    cViz.chats.length = 0;
    await dormir(3200);
    cDono.enviar({ t: 'convite.resgatar', codigo: cod });
    await cDono.esperar((m) => m.marco != null || m.recusa);
    await dormir(600);
    ok(cViz.chats.filter((m) => m.conviteResgate).length === 0,
      'um código já gasto não anuncia nada');
    await desligar(cDono, cViz);
  }
} catch (err) {
  falhas++;
  console.log(`  ✗ erro: ${err.stack ?? err.message}`);
} finally {
  for (const c of sockets) c.ws.close();
  await limpar().catch((err) => console.error('faxina falhou:', err.message));
  await pool.end().catch(() => {});
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} passaram`);
process.exit(falhas ? 1 : 0);
