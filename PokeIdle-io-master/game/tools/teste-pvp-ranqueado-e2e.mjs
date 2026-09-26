// PvP RANQUEADO de ponta a ponta: clientes WebSocket de verdade contra o servidor no ar.
//
// `teste-pvp-rank.mjs` prova a ARITMÉTICA (a escada, o Elo, o pareamento) sem infra nenhuma.
// Este aqui prova o que só o sistema inteiro pode provar, e em especial as travas de abuso que
// o pedido nomeia uma por uma:
//
//   1. os comandos atravessam gateway → Redis → sim → pareador → gateway;
//   2. a fila RECUSA quem não pode entrar (nível, equipe vazia, espera entre partidas);
//   3. dois jogadores na fila se encontram, a partida acontece e os DOIS recebem a fita;
//   4. o resultado é soma zero e está GRAVADO no Postgres antes de chegar na tela;
//   5. DESLOGAR NÃO SALVA NINGUÉM — o item que mais pesa no pedido. A prova não é um
//      cronômetro (a janela entre gravar e entregar é de milissegundos): é a INVARIANTE de que
//      o resultado já está no Postgres no instante em que a fita chega à tela;
//   6. o que o jogador não chegou a ver espera na caixa postal, e só uma vez;
//   7. sair da fila DE VERDADE tira da fila — e cair da conexão também;
//   8. o mesmo par não se reencontra dentro da janela de revanche;
//   9. um cliente adulterado não consegue mandar equipe que não é dele.
//
// Precisa do servidor de pé:  npm run infra && npm start
//   node tools/teste-pvp-ranqueado-e2e.mjs
import { WebSocket } from 'ws';
import { helloCom } from './auth-teste.mjs';
import { criarMescladorDeEstado } from '../src/shared/estado-delta.mjs';
import { pool } from '../src/server/db.mjs';
import { assinarSessao } from '../src/server/auth.mjs';
import {
  PVP_ATRITO_DERROTA,
  PVP_NIVEL_MIN,
  PVP_PONTOS_INICIAIS,
  rankDePontos,
} from '../src/shared/pvp-rank.mjs';
import { xpTotalParaNivel } from '../src/server/content.mjs';
import { ENTRE_PARTIDAS_MS } from '../src/server/game/pvp-ranqueado.mjs';

const URL = process.env.URL ?? 'ws://localhost:8080';
const marca = Math.floor(Math.random() * 9000 + 1000);
const A = `rkA${marca}`;
const B = `rkB${marca}`;
const C = `rkC${marca}`;

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

/** Um cliente: guarda tudo que chega, para o teste consultar depois. */
function cliente(nick, nivel = 1) {
  const c = {
    nick,
    ws: new WebSocket(URL),
    estado: null,
    welcome: null,
    eventos: [],
    pvp: [], // TODOS os pacotes `pvp` — a ordem importa nos testes de corrida
    pronto: null,
  };
  const mesclar = criarMescladorDeEstado();
  c.pronto = new Promise((resolve) => {
    c.ws.on('open', async () => {
      try {
        const sessao = await sessaoPara(nick, nivel);
        c.ws.send(JSON.stringify(helloCom(sessao)));
      } catch (err) {
        console.error(`auth ${nick}:`, err.message);
      }
    });
    c.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') {
        c.welcome = m;
        c.estado = mesclar(m.estado);
        resolve();
      } else if (m.t === 'estado') c.estado = mesclar(m.estado);
      else if (m.t === 'batalha') c.eventos.push(...m.ev);
      else if (m.t === 'pvp') c.pvp.push(m);
    });
  });
  c.enviar = (o) => c.ws.send(JSON.stringify(o));
  /**
   * O último pacote `pvp` que trouxe este campo.
   *
   * `desde` NÃO é decoração: sem ele, `ultimo('fila')` acha a resposta de dez comandos atrás
   * e uma asserção passa sobre um pacote velho. Aconteceu — a primeira versão deste arquivo
   * dizia "A entra na fila" lendo o `na: true` da entrada anterior, e só a asserção seguinte
   * (que exigia o contrário) denunciou. Todo teste de fila aqui marca o ponto antes de
   * mandar o comando e só olha do ponto em diante.
   */
  c.ultimo = (campo, desde = 0) =>
    [...c.pvp.slice(desde)].reverse().find((m) => m[campo] !== undefined) ?? null;
  /** Onde a caixa de entrada está AGORA — o marcador para o `desde` acima. */
  c.marca = () => c.pvp.length;
  c.partida = (desde = 0) => c.ultimo('partida', desde)?.partida ?? null;
  return c;
}

/**
 * A conta de teste, criada DIRETO no banco e com a sessão assinada aqui.
 *
 * ### Por que não pela rota pública
 *
 * `/auth/criar` exige Turnstile, e o `.env` local o tem ligado — foi o que já derrubou o
 * `tela.mjs` e derrubaria este arquivo do mesmo jeito. Assinar o token direto é o que
 * `tools/sessao-local.mjs` faz para os prints, e só funciona com o mesmo `AUTH_SEGREDO` do
 * servidor no ar, que é o caso.
 *
 * ### Por que o NÍVEL entra aqui, e não num UPDATE depois
 *
 * A linha de `players` é criada no primeiro login e daí em diante quem manda é a MEMÓRIA do
 * sim: o write-behind grava por cima a cada cinco segundos. Um `UPDATE players SET level`
 * com o jogador conectado dura até o flush seguinte e some — foi exatamente o que fez a
 * primeira versão deste teste ver "seu nv 1" depois de mandar 85 para o banco. Semear a
 * linha ANTES de qualquer conexão é o único jeito honesto: o sim a lê no login e a memória
 * já nasce certa.
 */
async function sessaoPara(nick, nivel = 1) {
  const { rows } = await pool.query(
    `INSERT INTO accounts (nick, email, provedor, email_ok, nick_ok)
     VALUES ($1, $2, 'local', true, true)
     ON CONFLICT (nick) DO UPDATE SET nick = EXCLUDED.nick
     RETURNING id, nick, provedor`,
    [nick, `${nick.toLowerCase()}@gmail.com`],
  );
  await pool.query(
    `INSERT INTO players (nick, level, xp) VALUES ($1, $2, $3)
     ON CONFLICT (nick) DO NOTHING`,
    [nick, nivel, xpTotalParaNivel(nivel)],
  );
  const conta = rows[0];
  return {
    nick: conta.nick,
    token: await assinarSessao({ nick: conta.nick, contaId: Number(conta.id), provedor: conta.provedor }),
  };
}

async function ate(cond, ms = 25000, passo = 150) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (cond()) return true;
    await dormir(passo);
  }
  return false;
}

/** O que está GRAVADO — a única fonte que vale quando se testa "isso sobreviveu?". */
async function rankNoBanco(nick) {
  const { rows } = await pool.query(
    `SELECT r.* FROM pvp_rank r JOIN players p ON p.id = r.player_id WHERE lower(p.nick) = lower($1)`,
    [nick],
  );
  return rows[0] ?? null;
}

async function partidasNoBanco(nick) {
  const { rows } = await pool.query(
    `SELECT * FROM pvp_partidas WHERE lower(a_nick) = lower($1) OR lower(b_nick) = lower($1)
      ORDER BY criado_em DESC`,
    [nick],
  );
  return rows;
}

console.log(`PvP RANQUEADO — ponta a ponta (${URL})\n${'='.repeat(48)}`);

// `Z` existe só para provar a recusa por nível; `A` e `B` nascem já no nível do PvP,
// porque semear o nível DEPOIS do login não sobrevive ao write-behind (ver `sessaoPara`).
const z = cliente(`rkZ${marca}`, 1);
const a2 = cliente(A, PVP_NIVEL_MIN + 5);
const b2 = cliente(B, PVP_NIVEL_MIN + 5);
await Promise.all([z.pronto, a2.pronto, b2.pronto]);
const a = a2;
const b = b2;

secao('Login');
ok(!!a.welcome && !!b.welcome, 'os dois conectam e recebem welcome');
ok(
  a.estado.pvp?.pontos === PVP_PONTOS_INICIAIS,
  `treinador novo nasce com ${PVP_PONTOS_INICIAIS} PR`,
  `${a.estado.pvp?.pontos}`,
);
ok(
  a.estado.pvp?.partidas === 0 && a.estado.pvp?.tierId === rankDePontos(PVP_PONTOS_INICIAIS).tierId,
  'e o snapshot já traz o rank para a ficha do treinador',
);

// Conta nova nasce sem pokémon E sem visual: monta o personagem e só então escolhe o starter.
for (const c of [a2, b2]) {
  if (!c.welcome.starters?.length) continue;
  c.enviar({ t: 'visual.set', genero: 'male', visual: {} });
  c.enviar({ t: 'starter.pick', speciesId: 4 });
}
ok(await ate(() => a.estado.pokemons.length && b.estado.pokemons.length), 'os dois ganham o starter');

// ------------------------------------------------------------- 2. as recusas

secao('A fila recusa quem não pode entrar');

z.enviar({ t: 'pvp.fila.entrar' });
ok(
  await ate(() => z.ultimo('filaRecusa')?.filaRecusa?.motivo === 'nivel'),
  `nível abaixo de ${PVP_NIVEL_MIN} é recusado`,
  JSON.stringify(z.ultimo('filaRecusa')?.filaRecusa),
);
z.ws.close();
ok(a2.estado.level >= PVP_NIVEL_MIN, 'A e B estão no nível do PvP', `${a2.estado.level}`);

a2.enviar({ t: 'pvp.fila.entrar' });
ok(
  await ate(() => a2.ultimo('filaRecusa')?.filaRecusa?.motivo === 'time'),
  'sem equipe salva, a fila recusa',
  JSON.stringify(a2.ultimo('filaRecusa')?.filaRecusa),
);

secao('A equipe é conferida contra o banco');
// Um cliente adulterado mandando o id de um pokémon que não é dele.
a2.enviar({ t: 'pvp.time.salvar', pokemonIds: [b2.estado.pokemons[0].id] });
ok(
  await ate(() => a2.ultimo('recusa')?.recusa?.codigo === 'sumiu' || a2.ultimo('recusa')?.recusa),
  'salvar a equipe com o pokémon de OUTRO jogador é recusado',
  JSON.stringify(a2.ultimo('recusa')?.recusa),
);

for (const c of [a2, b2]) c.enviar({ t: 'pvp.time.salvar', pokemonIds: [c.estado.pokemons[0].id] });
ok(
  await ate(() => a2.ultimo('timeSalvo')?.timeSalvo?.length === 1 && b2.ultimo('timeSalvo')?.timeSalvo?.length === 1),
  'com o próprio pokémon, a equipe salva',
);

// -------------------------------------------------------------- 3. a partida

secao('A partida acontece');

const antesA = await rankNoBanco(A);
const antesB = await rankNoBanco(B);

const mA = a2.marca();
const mB = b2.marca();
a2.enviar({ t: 'pvp.fila.entrar' });
ok(await ate(() => a2.ultimo('fila', mA)?.fila?.na === true), 'A entra na fila');
b2.enviar({ t: 'pvp.fila.entrar' });
ok(await ate(() => b2.ultimo('fila', mB)?.fila?.na === true), 'B entra na fila');

ok(await ate(() => a2.partida(mA) && b2.partida(mB), 30000), 'os dois recebem a partida');

const pa = a2.partida(mA);
const pb = b2.partida(mB);
ok(!!pa?.replay?.quadros?.length, `a fita chega com ${pa?.replay?.quadros?.length} quadros`);
ok(pa?.replay?.atores?.length === 4, 'quatro atores na fita (dois pokémon, dois treinadores)');
ok(pa?.id === pb?.id, 'é a MESMA partida para os dois', `${pa?.id} × ${pb?.id}`);
ok(pa?.venci !== pb?.venci, 'um ganhou e o outro perdeu');
{
  const ganho = pa.venci ? pa.delta : pb.delta;
  const perda = pa.venci ? pb.delta : pa.delta;
  ok(ganho > 0, `o vencedor sobe (${ganho} PR)`);
  // A escada NÃO é soma zero: a derrota custa uma fração do que a vitória paga, e é isso
  // que permite a população subir a partir do chão. No chão, ela não custa nada — o piso
  // segura, que é exatamente o caso destes dois jogadores estreando.
  ok(
    perda <= 0 && Math.abs(perda) <= Math.ceil(ganho * PVP_ATRITO_DERROTA),
    `e o perdedor paga no máximo ${PVP_ATRITO_DERROTA * 100}% disso (${perda} PR)`,
  );
}
ok(pa?.oponente?.nick?.toLowerCase() === B.toLowerCase(), 'A vê B como oponente');
ok(pb?.oponente?.nick?.toLowerCase() === A.toLowerCase(), 'e B vê A');

secao('E está GRAVADA antes de chegar na tela');
const depoisA = await rankNoBanco(A);
const depoisB = await rankNoBanco(B);
ok(depoisA.partidas === antesA.partidas + 1, 'a partida entrou na conta de A');
ok(depoisB.partidas === antesB.partidas + 1, 'e na de B');
ok(depoisA.pontos === antesA.pontos + pa.delta, `o PR de A no banco bate com a tela (${depoisA.pontos})`);
ok(depoisB.pontos === antesB.pontos + pb.delta, `e o de B também (${depoisB.pontos})`);
ok(
  depoisA.pontos + depoisB.pontos >= antesA.pontos + antesB.pontos,
  'a soma dos dois não ENCOLHEU — a escada injeta, nunca destrói',
);
ok(depoisA.vitorias + depoisB.vitorias === 1, 'exatamente uma vitória foi contada');
ok(
  depoisA.partidas + depoisB.partidas === antesA.partidas + antesB.partidas + 2,
  'e a partida entrou na conta dos DOIS',
);

const linhas = await partidasNoBanco(A);
ok(linhas.length >= 1, 'o resumo foi para o histórico');
ok(
  (linhas[0].venceu_a ? Number(linhas[0].a_delta) : Number(linhas[0].b_delta)) > 0,
  'e o histórico guarda o ganho do vencedor',
);

secao('A espera entre partidas');
{
  const m = a2.marca();
  a2.enviar({ t: 'pvp.fila.entrar' });
  ok(
    await ate(() => a2.ultimo('filaRecusa', m)?.filaRecusa?.motivo === 'cooldown'),
    `logo depois da partida a fila recusa (espera de ${ENTRE_PARTIDAS_MS / 1000}s)`,
    JSON.stringify(a2.ultimo('filaRecusa', m)?.filaRecusa),
  );
}

// ------------------------------------- 5. deslogar não salva ninguém

secao('DESLOGAR NÃO SALVA NINGUÉM');

// O pedido pede este teste pelo nome, e a resposta do desenho é que a pergunta não existe:
// NÃO HÁ "meio da partida". O pareamento simula a luta inteira, grava os pontos em transação
// e só então manda a fita. Fechar a aba, puxar o cabo ou matar o processo do navegador acontece
// sempre DEPOIS de o resultado ser um fato no Postgres.
//
// Provar isso com um cronômetro seria flagrante de corrida (a janela entre gravar e entregar
// é de milissegundos). O que se prova aqui é a INVARIANTE que a torna irrelevante: no
// instante em que o pacote chega ao cliente, a linha JÁ está no banco com os pontos movidos.
// Se está gravado antes de sair, nada que o cliente faça depois pode desfazê-lo.

const c2 = cliente(C, PVP_NIVEL_MIN + 5);
await c2.pronto;
if (c2.welcome.starters?.length) {
  c2.enviar({ t: 'visual.set', genero: 'male', visual: {} });
  c2.enviar({ t: 'starter.pick', speciesId: 4 });
}
ok(await ate(() => c2.estado.pokemons.length), 'C ganha o starter');
c2.enviar({ t: 'pvp.time.salvar', pokemonIds: [c2.estado.pokemons[0].id] });
ok(await ate(() => c2.ultimo('timeSalvo')), 'C salva a equipe');

await dormir(ENTRE_PARTIDAS_MS + 2000); // a espera entre partidas de B

const antesB2 = await rankNoBanco(B);
const antesC = await rankNoBanco(C);

const mB2 = b2.marca();
const mC = c2.marca();
b2.enviar({ t: 'pvp.fila.entrar' });
c2.enviar({ t: 'pvp.fila.entrar' });
ok(
  await ate(() => b2.ultimo('fila', mB2)?.fila?.na === true && c2.ultimo('fila', mC)?.fila?.na === true),
  'B e C entram na fila',
);
ok(await ate(() => b2.partida(mB2) && c2.partida(mC), 30000), 'B e C se enfrentam');

// A leitura acontece agora, no primeiro instante possível depois de o pacote chegar.
//
// A medida é a CONTAGEM DE PARTIDAS, e não os pontos, e a diferença importa: um perdedor
// que já estava no piso não muda de PR (o piso segura), então "os pontos mudaram" falharia
// numa partida perfeitamente normal — e falharia dizendo a coisa errada. `partidas` sobe
// sempre, nos dois lados, e prova exatamente o mesmo: o resultado já é um fato gravado.
const gravadaNaHora = await rankNoBanco(C);
ok(
  gravadaNaHora.partidas === antesC.partidas + 1,
  'no instante em que a fita chega, a partida JÁ está contada no banco',
  `${antesC.partidas} → ${gravadaNaHora.partidas}`,
);
ok(
  (await partidasNoBanco(C)).length >= 1,
  'e o resumo dela também — não há nada pendente que um deslog possa cancelar',
);

// Agora sim: C some do ar sem cerimônia. Nada disso pode mexer no que já está gravado.
c2.ws.terminate();
await dormir(3000);

const depoisB2 = await rankNoBanco(B);
const depoisC = await rankNoBanco(C);
ok(depoisB2.partidas === antesB2.partidas + 1, 'a partida contou para quem ficou');
ok(depoisC.partidas === antesC.partidas + 1, 'e continua contada para quem sumiu');
ok(
  depoisC.pontos === gravadaNaHora.pontos,
  'puxar o cabo NÃO desfez o resultado',
  `${gravadaNaHora.pontos} → ${depoisC.pontos}`,
);
ok(
  depoisB2.pontos >= antesB2.pontos && depoisC.pontos <= antesC.pontos
  || depoisC.pontos >= antesC.pontos && depoisB2.pontos <= antesB2.pontos,
  `um subiu e o outro não (${depoisB2.pontos - antesB2.pontos} × ${depoisC.pontos - antesC.pontos})`,
);

secao('E o que ele não viu espera na caixa postal');
// C nunca mandou `pvp.partida.vista` (é o cliente de verdade que manda, ao tocar a fita), então
// o resultado continua marcado como não visto — é o caminho de quem cai antes de a fita chegar.
const c3 = cliente(C, PVP_NIVEL_MIN + 5);
await c3.pronto;
const mC3 = c3.marca();
c3.enviar({ t: 'pvp.info' });
ok(await ate(() => c3.ultimo('naoVistas', mC3)), 'C reconecta e a aba responde');
const naoVistas = c3.ultimo('naoVistas', mC3)?.naoVistas ?? [];
ok(naoVistas.length >= 1, 'a partida que ele não viu está esperando por ele', `${naoVistas.length}`);
ok(
  naoVistas.some((x) => x.oponente?.toLowerCase() === B.toLowerCase()),
  'e é a partida contra B',
);

const mC4 = c3.marca();
c3.enviar({ t: 'pvp.info' });
ok(
  await ate(() => (c3.ultimo('naoVistas', mC4)?.naoVistas ?? []).length === 0),
  'e some na segunda leitura — a caixa postal é marcada ao ser lida, não mostra duas vezes',
);

// ---------------------------------------------------------- 7. sair da fila

secao('Sair da fila, e cair da fila');
await dormir(ENTRE_PARTIDAS_MS + 2000);
{
  const m = a2.marca();
  a2.enviar({ t: 'pvp.fila.entrar' });
  ok(await ate(() => a2.ultimo('fila', m)?.fila?.na === true), 'A entra na fila de novo',
    JSON.stringify(a2.ultimo('filaRecusa', m)?.filaRecusa));
}
{
  const m = a2.marca();
  a2.enviar({ t: 'pvp.fila.sair' });
  ok(await ate(() => a2.ultimo('fila', m)?.fila?.na === false), 'e sai quando pede');
}

{
  const m = a2.marca();
  a2.enviar({ t: 'pvp.fila.entrar' });
  ok(await ate(() => a2.ultimo('fila', m)?.fila?.na === true), 'entra mais uma vez');
}
a2.ws.terminate();
await dormir(3000);
const a3 = cliente(A, PVP_NIVEL_MIN + 5);
await a3.pronto;
const mA3 = a3.marca();
a3.enviar({ t: 'pvp.info' });
ok(await ate(() => a3.ultimo('fila', mA3)), 'A reconecta e a aba responde');
ok(
  a3.ultimo('fila', mA3)?.fila?.na === false,
  'perder a conexão TIRA da fila — ninguém é pareado enquanto está fora do ar',
  JSON.stringify(a3.ultimo('fila', mA3)?.fila),
);

// -------------------------------------------------------------- 8. revanche

secao('Revanche: o mesmo par não se reencontra em seguida');
await dormir(ENTRE_PARTIDAS_MS + 1000);
const antesRevanche = (await partidasNoBanco(A)).length;
const mRevA = a3.marca();
const mRevB = b2.marca();
a3.enviar({ t: 'pvp.fila.entrar' });
b2.enviar({ t: 'pvp.fila.entrar' });
ok(
  await ate(() => a3.ultimo('fila', mRevA)?.fila?.na && b2.ultimo('fila', mRevB)?.fila?.na),
  'A e B voltam à fila',
);
await dormir(14000); // várias passadas do pareador
ok(
  (await partidasNoBanco(A)).length === antesRevanche,
  'e NÃO se enfrentam — o bloqueio de revanche segurou',
);
ok(
  !a3.partida(mRevA) && !b2.partida(mRevB),
  'os dois continuam esperando, sem partida nenhuma',
);

for (const c of [a3, b2, c3]) c.ws.close();
await pool.end();

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
