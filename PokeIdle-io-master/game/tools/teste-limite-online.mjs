// O teto de SESSÕES SIMULTÂNEAS por rede — "4 contas jogando ao mesmo tempo, a 5ª não entra".
//
// São duas metades, e as duas estão aqui porque falham por motivos diferentes:
//
//   1. **O contador** (`bus.mjs`), contra o Redis de verdade. É onde mora a corrida: quatro
//      navegadores abrindo juntos é o uso NORMAL desta feature, não um caso raro, e um
//      `HLEN` seguido de `HSET` deixaria os dois quintos entrarem. O teste de concorrência
//      abaixo dispara 12 entradas ao mesmo tempo e exige que exatamente 4 passem.
//
//   2. **O jogo inteiro**, com WebSocket de verdade contra um gateway de verdade. Sobe o
//      servidor numa porta própria, cria contas, assina sessões e conecta. É o único jeito de
//      responder "são mesmo 4?" sem depender de eu ter ligado os fios certos — e foi para
//      isso que ele existe: o contador pode estar perfeito e a chamada estar no lugar errado.
//
// O IP de cada conexão é escolhido pelo cabeçalho `CF-Connecting-IP` (é o primeiro que
// `ip-cliente.mjs` lê), então dá para simular redes diferentes sem sair do localhost.
//
// Precisa de Postgres e Redis de pé. Sobe e derruba o próprio servidor:
//
//   docker compose up -d && node tools/teste-limite-online.mjs
import { spawn } from 'node:child_process';
import { setTimeout as dormir } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';
import { pool } from '../src/server/db.mjs';
import {
  pub, entrarNaRede, sairDaRede, quemEstaNaRede, limparOnlineDoGateway, limparOnlineOrfao,
  marcarGatewayVivo, gatewaysVivos, reafirmarOnline, chaveOnlineIp,
} from '../src/server/bus.mjs';
import * as odb from '../src/server/origens-db.mjs';
import { assinarSessao } from '../src/server/auth.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
// Curto de propósito: o gateway exige nick de 3 a 16 caracteres, e um prefixo descritivo
// estourava o limite — a conexão morria em "Nick inválido" antes de chegar ao teste.
const PREFIXO = `zt${Date.now().toString(36).slice(-6)}`;
const IP_CASA = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
const IP_OUTRO = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
const PORTA = 8099;
const LIMITE = 4;

const contas = [];
const players = [];
const chavesRedis = new Set();
let servidor = null;

async function criarConta(sufixo) {
  const nick = `${PREFIXO}_${sufixo}`;
  const { rows: a } = await pool.query(
    `INSERT INTO accounts (nick, email, provedor, email_ok, nick_ok, ultimo_login)
     VALUES ($1, $2, 'local', true, true, now()) RETURNING id`,
    [nick, `${nick}@exemplo.invalido`],
  );
  const contaId = Number(a[0].id);
  contas.push(contaId);
  const { rows: p } = await pool.query(
    `INSERT INTO players (nick, level) VALUES ($1, 5) RETURNING id`, [nick],
  );
  players.push(Number(p[0].id));
  const token = await assinarSessao({ nick, contaId, provedor: 'local' });
  return { contaId, nick, token };
}

/**
 * Conecta um socket e espera o veredito: `welcome` (entrou) ou `erro` (barrado).
 *
 * O timeout é generoso porque o `welcome` carrega os catálogos do jogo inteiro; o que se está
 * medindo aqui é qual dos dois chegou, não quão rápido.
 */
function conectar(conta, ip) {
  return new Promise((resolve) => {
    // A cadeia de produção: o Cloudflare escreve o `CF-Connecting-IP` e o Caddy acrescenta o peer
    // (um endereço do Cloudflare) ao `X-Forwarded-For`. Sem o peer do Cloudflare o servidor
    // ignora o cabeçalho — ver `ip-cliente.mjs`.
    const ws = new WebSocket(`ws://127.0.0.1:${PORTA}`, {
      headers: { 'cf-connecting-ip': ip, 'x-forwarded-for': '172.68.0.1' },
    });
    const fim = (r) => { clearTimeout(relogio); resolve({ ws, ...r }); };
    const relogio = setTimeout(() => fim({ estado: 'silencio' }), 15_000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token: conta.token, nick: conta.nick })));
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'welcome') return fim({ estado: 'entrou' });
      if (m.t === 'erro') return fim({ estado: 'barrado', chave: m.chave, msg: m.msg });
    });
    ws.on('error', () => fim({ estado: 'erro-socket' }));
  });
}

const fechar = (r) => new Promise((resolve) => {
  if (!r?.ws || r.ws.readyState > 1) return resolve();
  r.ws.on('close', resolve);
  r.ws.close();
  setTimeout(resolve, 3000);
});

/**
 * Sobe o gateway numa porta própria e espera o `/saude`.
 *
 * ### Por que tem retentativa
 *
 * O sim toma uma TRAVA DE POSSE do shard (ver `bus.mjs`) e ela só expira 15 s depois que o
 * dono morre. Rodar este teste duas vezes seguidas — que é exatamente o que se faz enquanto
 * se mexe no código — fazia o segundo processo encontrar a trava do primeiro e encerrar na
 * hora, e o teste acusava um bug que não existia. A trava é a proteção certa; quem tem de se
 * adaptar é o teste.
 */
async function subirServidor() {
  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    let saida = '';
    servidor = spawn(process.execPath, ['src/server/index.mjs'], {
      cwd: raiz,
      env: { ...process.env, PORT: String(PORTA), ROLE: 'all', MAX_ONLINE_POR_IP: String(LIMITE) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    servidor.stdout.on('data', (d) => { saida += d; });
    servidor.stderr.on('data', (d) => { saida += d; });

    let morreu = false;
    for (let i = 0; i < 120; i++) {
      await dormir(500);
      try {
        const r = await fetch(`http://127.0.0.1:${PORTA}/saude`);
        if (r.ok) return true;
      } catch {}
      if (servidor.exitCode !== null) { morreu = true; break; }
    }

    if (!morreu) {
      console.log(`  ! servidor não respondeu em 60 s:\n${saida.slice(-1500)}`);
      return false;
    }
    if (!/JÁ TEM DONO/.test(saida) || tentativa === 4) {
      console.log(`  ! servidor morreu no boot:\n${saida.slice(-1500)}`);
      return false;
    }
    console.log(`  · trava de shard do processo anterior ainda de pé; esperando (${tentativa}/3)`);
    await dormir(9000);
  }
  return false;
}

async function limpar() {
  if (servidor && servidor.exitCode === null) {
    servidor.kill();
    await dormir(800);
  }
  if (players.length) await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [players]);
  if (contas.length) {
    await pool.query(`DELETE FROM conta_origens WHERE conta_id = ANY($1::bigint[])`, [contas]);
    await pool.query(`DELETE FROM accounts WHERE id = ANY($1::bigint[])`, [contas]);
  }
  await pool.query(`DELETE FROM origem_liberada WHERE ip_bucket = ANY($1::text[])`, [[IP_CASA, IP_OUTRO]]);
  await pool.query(`DELETE FROM origem_recusas WHERE ip_bucket = ANY($1::text[])`, [[IP_CASA, IP_OUTRO]]);
  for (const c of chavesRedis) await pub.del(c).catch(() => {});
}

console.log('Teto de sessões simultâneas por rede\n===================================');

try {
  await odb.migrar();
  chavesRedis.add(chaveOnlineIp(IP_CASA));
  chavesRedis.add(chaveOnlineIp(IP_OUTRO));
  for (const c of chavesRedis) await pub.del(c);

  // ================================================================ o contador
  secao('O contador, direto no Redis');

  const entrar = (nick, ip = IP_CASA, gw = 'gw-teste') =>
    entrarNaRede({ ipBucket: ip, playerId: nick, gatewayId: gw, limite: LIMITE });

  for (let i = 1; i <= LIMITE; i++) {
    const r = await entrar(`conta${i}`);
    ok(r.pode && r.contagem === i, `a ${i}ª conta entra (contagem ${r.contagem})`, JSON.stringify(r));
  }
  const quinta = await entrar('conta5');
  ok(!quinta.pode && quinta.contagem === LIMITE, 'a 5ª é BARRADA', JSON.stringify(quinta));
  ok((await quemEstaNaRede(IP_CASA)).length === LIMITE, 'e não ficou pendurada no balde');

  const denovo = await entrar('conta1');
  ok(denovo.pode && denovo.contagem === LIMITE, 'outra aba da MESMA conta entra e não gasta vaga (F5)');

  await sairDaRede(IP_CASA, 'conta2');
  ok((await quemEstaNaRede(IP_CASA)).length === LIMITE - 1, 'sair devolve a vaga');
  const agoraCabe = await entrar('conta5');
  ok(agoraCabe.pode && agoraCabe.contagem === LIMITE, 'e aí a 5ª entra no lugar');

  const outraRede = await entrar('conta9', IP_OUTRO);
  ok(outraRede.pode && outraRede.contagem === 1, 'outra rede tem o próprio balde');

  ok((await entrarNaRede({ ipBucket: null, playerId: 'x', gatewayId: 'g', limite: LIMITE })).pode,
    'sem IP legível, passa (falha aberta)');
  const semTeto = await entrarNaRede({ ipBucket: IP_CASA, playerId: 'semteto', gatewayId: 'g', limite: 0 });
  ok(semTeto.pode, 'com o limite em 0 (whitelist / regra desligada), passa mesmo com a rede cheia');
  ok((await quemEstaNaRede(IP_CASA)).includes('semteto'),
    'e AINDA ASSIM é contada — é o que mantém honesta a coluna "on-line agora" do painel');
  await sairDaRede(IP_CASA, 'semteto');

  // ---- a corrida
  secao('A corrida (4 navegadores abrindo juntos)');
  await pub.del(chaveOnlineIp(IP_CASA));
  const juntos = await Promise.all(
    Array.from({ length: 12 }, (_, i) => entrar(`corrida${i}`)),
  );
  const passaram = juntos.filter((r) => r.pode).length;
  ok(passaram === LIMITE, `de 12 entradas simultâneas, exatamente ${LIMITE} passaram`, `passaram ${passaram}`);
  ok((await quemEstaNaRede(IP_CASA)).length === LIMITE, 'e o balde tem exatamente 4 dentro');

  // ---- faxina de gateway morto
  //
  // É o cenário que trancaria jogador de verdade: um gateway cai com quatro contas de uma casa
  // dentro, e as vagas ficam ocupadas por sockets que não existem mais. Sem a faxina, aquela
  // família ficaria fora do jogo até o TTL de 12 h vencer — e o `gatewayId` é um UUID novo a
  // cada boot, então o processo que sobe no lugar não tem como reconhecer o que era do morto.
  secao('Gateway que caiu');
  await pub.del(chaveOnlineIp(IP_CASA));
  await entrar('viva', IP_CASA, 'gw-vivo');
  await entrar('morta1', IP_CASA, 'gw-morto');
  await entrar('morta2', IP_CASA, 'gw-morto');
  const limpos = await limparOnlineDoGateway('gw-morto');
  ok(limpos === 2, 'a faxina por id tira só o que era do gateway morto', `limpou ${limpos}`);
  const sobrou = await quemEstaNaRede(IP_CASA);
  ok(sobrou.length === 1 && sobrou[0] === 'viva', 'e o que estava vivo continua lá', JSON.stringify(sobrou));

  // A faxina de VERDADE é a por heartbeat: quem não carimba há mais de 90 s é dado como morto.
  // Nenhum processo precisa saber o id de quem caiu — que é o ponto, porque ninguém sabe.
  await pub.del(chaveOnlineIp(IP_CASA));
  await marcarGatewayVivo('gw-que-esta-vivo');
  await entrar('daVida', IP_CASA, 'gw-que-esta-vivo');
  await entrar('daMorte1', IP_CASA, 'gw-que-morreu-sem-avisar');
  await entrar('daMorte2', IP_CASA, 'gw-que-morreu-sem-avisar');
  await entrar('daMorte3', IP_CASA, 'gw-que-morreu-sem-avisar');
  ok((await quemEstaNaRede(IP_CASA)).length === 4, 'rede cheia, três vagas presas num gateway fantasma');
  ok(!(await entrar('maisUma')).pode, 'e por isso a próxima é barrada');

  // A varredura é GLOBAL de propósito (ninguém sabe o id de quem caiu, então ela olha todos os
  // baldes), logo o total inclui resíduo de outras redes deste mesmo teste. Quem é exato aqui
  // é o conteúdo do balde desta rede, conferido na linha de baixo.
  const orfaos = await limparOnlineOrfao();
  ok(orfaos >= 3, 'a faxina por heartbeat solta as vagas do fantasma', `soltou ${orfaos}`);
  const vivos = await quemEstaNaRede(IP_CASA);
  ok(vivos.length === 1 && vivos[0] === 'daVida', 'sem encostar em quem estava vivo', JSON.stringify(vivos));
  ok((await entrar('maisUma')).pode, 'e a casa volta a conseguir entrar');
  ok(!(await gatewaysVivos()).has('gw-que-morreu-sem-avisar'), 'o gateway morto sai do registro de vivos');

  // O contrapeso: um gateway varrido por engano re-afirma as vagas que tem de verdade.
  await pub.del(chaveOnlineIp(IP_CASA));
  await marcarGatewayVivo('gw-lento');
  await reafirmarOnline('gw-lento', [[IP_CASA, 'jogandoAinda'], [IP_CASA, 'jogandoTambem']]);
  const reafirmados = await quemEstaNaRede(IP_CASA);
  ok(
    reafirmados.length === 2 && reafirmados.includes('jogandoAinda'),
    'o re-carimbo devolve ao balde quem continua jogando',
    JSON.stringify(reafirmados),
  );
  await pub.hdel('gwvivos', 'gw-vivo', 'gw-que-esta-vivo', 'gw-lento');

  // ============================================================ o jogo inteiro
  secao('O jogo inteiro, com WebSocket de verdade');
  await pub.del(chaveOnlineIp(IP_CASA));
  await pub.del(chaveOnlineIp(IP_OUTRO));

  const jogadores = [];
  for (let i = 1; i <= 6; i++) jogadores.push(await criarConta(`j${i}`));

  if (!(await subirServidor())) {
    throw new Error('não deu para subir o servidor de teste');
  }
  ok(true, `servidor de teste de pé na porta ${PORTA}`);

  const abertos = [];
  for (let i = 0; i < LIMITE; i++) {
    const r = await conectar(jogadores[i], IP_CASA);
    abertos.push(r);
    ok(r.estado === 'entrou', `conta ${i + 1} de ${LIMITE} entrou no jogo`, JSON.stringify(r.chave ?? r.estado));
  }

  const barrada = await conectar(jogadores[LIMITE], IP_CASA);
  ok(barrada.estado === 'barrado', 'a 5ª conta da MESMA rede é barrada', JSON.stringify(barrada.estado));
  ok(barrada.chave === 'login.limiteOnlineIp', 'com a chave certa', String(barrada.chave));
  ok(
    String(barrada.msg ?? '').includes('4 contas conectadas'),
    'e a mensagem diz o número',
    String(barrada.msg),
  );

  // A propriedade que mais importa e a que um teste de "a 5ª é barrada" não cobre sozinho:
  // recusar a quinta não pode encostar nas quatro que já estão jogando. Uma recusa que
  // derrubasse a sessão de alguém seria muito pior do que não ter limite nenhum.
  ok(
    abertos.every((a) => a.ws.readyState === 1),
    'e as 4 que já estavam dentro continuam conectadas',
    JSON.stringify(abertos.map((a) => a.ws.readyState)),
  );
  ok(
    (await quemEstaNaRede(IP_CASA)).length === LIMITE,
    'a recusa não deixou resíduo no balde da rede',
    String((await quemEstaNaRede(IP_CASA)).length),
  );

  await fechar(barrada);
  await dormir(500);
  // Fechar o socket RECUSADO não pode devolver uma vaga que ele nunca teve — senão a rede
  // passaria a aceitar uma quinta a cada tentativa barrada, e o limite viraria decoração.
  ok(
    (await quemEstaNaRede(IP_CASA)).length === LIMITE,
    'e fechar o socket recusado não abre vaga de graça',
    String((await quemEstaNaRede(IP_CASA)).length),
  );

  // A mesma conta barrada entra por OUTRA rede — o limite é da rede, não da conta.
  const porOutraRede = await conectar(jogadores[LIMITE], IP_OUTRO);
  ok(porOutraRede.estado === 'entrou', 'a mesma conta entra por outra rede');
  await fechar(porOutraRede);

  // F5: a conta 1 reconecta; continua sendo UMA conta na rede.
  const f5 = await conectar(jogadores[0], IP_CASA);
  ok(f5.estado === 'entrou', 'F5 da conta que já estava dentro entra de novo');
  await dormir(600);
  ok(
    (await quemEstaNaRede(IP_CASA)).length === LIMITE,
    'e a rede continua com 4 — o F5 não gastou vaga',
    JSON.stringify(await quemEstaNaRede(IP_CASA)),
  );
  const aindaBarrada = await conectar(jogadores[LIMITE + 1], IP_CASA);
  ok(aindaBarrada.estado === 'barrado', 'e a 5ª continua barrada depois do F5');
  await fechar(aindaBarrada);

  // Fechar uma libera a vaga na hora.
  await fechar(abertos[1]);
  await dormir(800);
  const depoisDeFechar = await conectar(jogadores[LIMITE], IP_CASA);
  ok(depoisDeFechar.estado === 'entrou', 'fechar uma conta libera a vaga para a próxima');
  await fechar(depoisDeFechar);
  await dormir(500);

  // ---- a whitelist
  secao('A whitelist');

  // Recompõe a rede do zero, com EXATAMENTE 4 contas distintas.
  //
  // A seção de cima fechou uma conexão e abriu outra para provar que a vaga volta, e com isso
  // deixou a rede com 3. Uma seção que herda o estado da anterior passa a mentir no dia em que
  // a anterior muda — e o que se quer medir aqui é a whitelist, não o resíduo do teste passado.
  for (const a of abertos) await fechar(a);
  await fechar(f5);
  await dormir(900);
  const cheios = [];
  for (let i = 0; i < LIMITE; i++) cheios.push(await conectar(jogadores[i], IP_CASA));
  ok(
    cheios.every((c) => c.estado === 'entrou')
      && (await quemEstaNaRede(IP_CASA)).length === LIMITE,
    'rede recomposta com exatamente 4 contas',
    JSON.stringify(cheios.map((c) => c.estado)),
  );

  const cheia = await conectar(jogadores[LIMITE], IP_CASA);
  ok(cheia.estado === 'barrado', 'antes da whitelist, a rede cheia barra', JSON.stringify(cheia.estado));
  await fechar(cheia);

  await odb.liberarIp({ ipBucket: IP_CASA, nota: 'casa com 8 irmãos', porEmail: 'teste@x' });
  await pub.publish('origens:whitelist', JSON.stringify({ ipBucket: IP_CASA }));
  await dormir(900);

  const liberada = await conectar(jogadores[LIMITE], IP_CASA);
  ok(liberada.estado === 'entrou', 'com o IP na whitelist, a 5ª entra', JSON.stringify(liberada.chave ?? ''));
  const sexta = await conectar(jogadores[LIMITE + 1], IP_CASA);
  ok(sexta.estado === 'entrou', 'e a 6ª também — whitelist é sem teto');
  ok(
    (await quemEstaNaRede(IP_CASA)).length === LIMITE + 2,
    'e as seis estão no balde da rede',
    String((await quemEstaNaRede(IP_CASA)).length),
  );
  await fechar(liberada);
  await fechar(sexta);

  await odb.travarIp(IP_CASA);
  await pub.publish('origens:whitelist', JSON.stringify({ ipBucket: IP_CASA }));
  await dormir(900);
  ok(!(await odb.redeLiberada(IP_CASA)), 'tirar da whitelist volta a valer o limite');

  for (const c of cheios) await fechar(c);
} catch (err) {
  falhas++;
  console.log(`\n  ✗ erro no meio do teste: ${err.stack}`);
} finally {
  await limpar().catch((err) => console.log(`  ! limpeza falhou: ${err.message}`));
  await pool.end();
  await pub.quit().catch(() => {});
}

console.log('\n==============================================');
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} passaram`);
process.exit(falhas ? 1 : 0);
