// PvP AMISTOSO de ponta a ponta, com o jogo no ar: convite, aceite, recusa, cancelamento, a
// espera de 5 min dos dois — e as tentativas de abuso que as travas existem para barrar.
//
//   node tools/teste-pvp-amistoso.mjs        (ou npm run test:pvp:amistoso)
//
// As contas nascem DIRETO no banco (sem a rota de cadastro, que passa pelo Turnstile) e são
// apagadas no fim, com as amizades, as conversas e as chaves do Redis.
import WebSocket from 'ws';
import Redis from 'ioredis';
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { assinarSessao } from '../src/server/auth.mjs';
import { especies } from '../src/server/content.mjs';

const WS_URL = process.env.WS_URL ?? 'ws://localhost:8080';
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const IVS = { hp: 20, atk: 20, def: 20, spAtk: 20, spDef: 20, speed: 20 };
const especiePorNome = (n) => [...especies.values()].find((e) => e.name === n);
const sufixo = String(Date.now() % 100000);
const criadas = [];

async function criarConta(nome, { especie = 'Pikachu' } = {}) {
  const nick = `pa${nome}${sufixo}`.slice(0, 16);
  const { rows: ac } = await pool.query(
    `INSERT INTO accounts (nick, email, provedor, email_ok, nick_ok) VALUES ($1, $2, 'local', true, true) RETURNING id, provedor`,
    [nick, `${nick}@test.local`],
  );
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp, gold, visual_ok, tutorial_visto, discord_pop_campanha, aviso_visto)
     VALUES ($1, 60, 0, 1000, true, true, 99, 99) RETURNING id`,
    [nick],
  );
  const id = Number(rows[0].id);
  const esp = especiePorNome(especie);
  const { rows: pk } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia, slot)
     VALUES ($1, $2, 80, 1.2, $3::jsonb, 9999, false, 3, 1) RETURNING id`,
    [id, esp.pokeId, JSON.stringify(IVS)],
  );
  await pool.query(`UPDATE players SET active_poke = $2 WHERE id = $1`, [id, Number(pk[0].id)]);
  criadas.push({ nick, id, contaId: Number(ac[0].id) });
  return {
    nick,
    id,
    key: nick.toLowerCase(),
    token: await assinarSessao({ nick, contaId: Number(ac[0].id), provedor: ac[0].provedor ?? 'local' }),
  };
}

async function amigos(a, b) {
  const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  await pool.query(`INSERT INTO amizades (a_id, b_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [x, y]);
}

/** Um socket logado que guarda tudo que chega e sabe esperar por uma condição. */
function conectar(conta) {
  return new Promise((resolver, rejeitar) => {
    const ws = new WebSocket(WS_URL);
    const msgs = [];
    const s = {
      conta,
      ws,
      msgs,
      mandar: (m) => ws.send(JSON.stringify(m)),
      limpar: () => { msgs.length = 0; },
      async esperar(pred, ms = 8000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const achou = msgs.find(pred);
          if (achou) return achou;
          await dormir(60);
        }
        return null;
      },
      avisos: () => msgs.filter((m) => m.t === 'evento' && m.k === 'aviso').map((m) => m.msg),
    };
    const prazo = setTimeout(() => rejeitar(new Error(`sem welcome para ${conta.nick}`)), 20_000);
    ws.on('message', (raw) => {
      let bruto;
      try { bruto = JSON.parse(raw.toString()); } catch { return; }
      // O tick manda um LOTE por jogador, e os avisos vão dentro do `batalha` (`ev: [...]`):
      // desembrulha tudo para o teste procurar mensagem a mensagem.
      for (const m of Array.isArray(bruto) ? bruto : [bruto]) {
        if (m?.t === 'batalha' && Array.isArray(m.ev)) for (const e of m.ev) msgs.push({ t: 'evento', ...e });
        else msgs.push(m);
        if (m?.t === 'welcome') { clearTimeout(prazo); resolver(s); }
      }
    });
    ws.on('open', () => s.mandar({ t: 'hello', token: conta.token }));
    ws.on('error', rejeitar);
  });
}

const aviso = (s, chave) => s.esperar((m) => m.t === 'evento' && m.k === 'aviso' && m.msg === chave, 6000);

async function limpar() {
  const ids = criadas.map((c) => c.id);
  const contas = criadas.map((c) => c.contaId);
  if (ids.length) {
    await pool.query(`DELETE FROM dm_mensagens WHERE de_id = ANY($1::bigint[]) OR para_id = ANY($1::bigint[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM amizades WHERE a_id = ANY($1::bigint[]) OR b_id = ANY($1::bigint[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM player_pokemon WHERE player_id = ANY($1::bigint[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [ids]).catch(() => {});
  }
  if (contas.length) {
    await pool.query(`DELETE FROM conta_origens WHERE conta_id = ANY($1::bigint[])`, [contas]).catch(() => {});
    await pool.query(`DELETE FROM accounts WHERE id = ANY($1::bigint[])`, [contas]).catch(() => {});
  }
  for (const c of criadas) {
    const k = c.nick.toLowerCase();
    await redis.del(`pvpa:cd:${k}`, `pvpa:saida:${k}`).catch(() => {});
  }
}

const sockets = [];
try {
  // ------------------------------------------------------------------ preparo
  const A = await criarConta('A', { especie: 'Pikachu' });
  const B = await criarConta('B', { especie: 'Charmander' });
  const C = await criarConta('C'); // estranho: amigo de ninguém aqui
  const D = await criarConta('D'); // amigo de B
  const E = await criarConta('E');
  const F = await criarConta('F');
  const G = await criarConta('G'); // amigo de E, fica OFFLINE
  await amigos(A, B);
  await amigos(B, D);
  await amigos(A, D);
  await amigos(E, F);
  await amigos(E, G);

  const [sA, sB, sC, sD, sE, sF] = await Promise.all([A, B, C, D, E, F].map(conectar));
  sockets.push(sA, sB, sC, sD, sE, sF);
  await dormir(800);

  // ------------------------------------------------------------------ o convite
  secao('Convite');
  sA.limpar(); sB.limpar();
  sA.mandar({ t: 'amigo.pvp.convidar', amigoId: B.id });
  const dmA = await sA.esperar((m) => m.t === 'amigos' && m.dm?.tipo === 3);
  const dmB = await sB.esperar((m) => m.t === 'amigos' && m.dm?.tipo === 3);
  ok(!!dmA, 'quem desafia vê a linha do convite na conversa');
  ok(!!dmB, 'o desafiado recebe o convite ao vivo');
  const conv = JSON.parse(dmB?.dm?.texto ?? '{}');
  const cid = conv.cid;
  ok(/^[0-9a-f]{32}$/.test(cid ?? ''), 'o convite tem um id de 32 hex', cid);
  ok(conv.estado === 'pendente' && conv.expiraEm > Date.now() + 4 * 60_000, 'nasce pendente, com ~5 min de prazo');
  ok(await redis.exists(`pvpa:conv:${cid}`) === 1, 'o convite existe no Redis');
  const ttl = await redis.pttl(`pvpa:conv:${cid}`);
  ok(ttl > 4 * 60_000 && ttl <= 5 * 60_000, 'e expira sozinho em 5 min (TTL)', `${ttl} ms`);

  secao('Abusos contra o convite');
  sC.limpar();
  sC.mandar({ t: 'amigo.pvp.convidar', amigoId: A.id });
  ok(!!(await aviso(sC, 'amigos.naoEncontrado')), 'quem não é amigo não desafia');
  sC.mandar({ t: 'amigo.pvp.responder', conviteId: cid, aceitar: true });
  ok(!!(await aviso(sC, 'amigos.pvpa.sumiu')), 'um estranho não aceita o convite dos outros');
  ok(await redis.exists(`pvpa:conv:${cid}`) === 1, '…e o convite continua de pé');
  sA.limpar();
  sA.mandar({ t: 'amigo.pvp.responder', conviteId: cid, aceitar: true });
  ok(!!(await aviso(sA, 'amigos.pvpa.sumiu')), 'quem desafiou não aceita o próprio convite');
  sC.mandar({ t: 'amigo.pvp.cancelar', conviteId: cid });
  ok(!!(await aviso(sC, 'amigos.pvpa.sumiu')), 'um estranho não cancela o convite');
  ok(await redis.exists(`pvpa:conv:${cid}`) === 1, '…e ele continua de pé');
  sA.limpar();
  sA.mandar({ t: 'amigo.pvp.convidar', amigoId: B.id });
  ok(!!(await aviso(sA, 'amigos.pvpa.devagar')), 'dois convites em menos de 5 s: o segundo é freado');
  await dormir(5200);
  sA.mandar({ t: 'amigo.pvp.convidar', amigoId: D.id });
  ok(!!(await aviso(sA, 'amigos.pvpa.jaTemConvite')), 'um convite pendente por vez — não dá para espalhar vários');

  // Pacotes malformados: nada disso pode derrubar o sim nem chegar ao Redis como chave.
  for (const lixo of [['x'], { a: 1 }, 'A'.repeat(32), '__proto__', '../../x', 'a'.repeat(5000), null, 12345]) {
    sB.mandar({ t: 'amigo.pvp.responder', conviteId: lixo, aceitar: true });
    sB.mandar({ t: 'amigo.pvp.fita', conviteId: lixo });
    sB.mandar({ t: 'amigo.pvp.cancelar', conviteId: lixo });
  }
  sB.mandar({ t: 'amigo.pvp.convidar', amigoId: '1e30' });
  sB.mandar({ t: 'amigo.pvp.convidar', amigoId: -5 });
  sB.mandar({ t: 'amigo.pvp.responder', conviteId: cid, aceitar: 'true' }); // string não é aceite
  await dormir(1200);
  ok(await redis.exists(`pvpa:conv:${cid}`) === 1, 'lixo no pacote e "aceitar" como texto não consomem o convite');
  const vivo = await fetch('http://localhost:8080/saude').then((r) => r.ok).catch(() => false);
  ok(vivo, 'o servidor continua de pé depois do lixo');

  // ------------------------------------------------------------------ o aceite
  secao('Aceite (dois cliques ao mesmo tempo)');
  sA.limpar(); sB.limpar();
  sB.mandar({ t: 'amigo.pvp.responder', conviteId: cid, aceitar: true });
  sB.mandar({ t: 'amigo.pvp.responder', conviteId: cid, aceitar: true });
  const fitaB = await sB.esperar((m) => m.t === 'amigos' && m.pvpAmistoso, 15000);
  const fitaA = await sA.esperar((m) => m.t === 'amigos' && m.pvpAmistoso, 15000);
  await dormir(1500);
  ok(!!fitaA && !!fitaB, 'os dois recebem a fita');
  ok(sB.msgs.filter((m) => m.pvpAmistoso).length === 1, 'o aceite duplo gerou UMA luta só');
  ok(!!(await aviso(sB, 'amigos.pvpa.sumiu')), 'o segundo clique encontra o convite já consumido');
  ok(fitaA?.pvpAmistoso?.replay?.atores?.length > 0, 'a fita tem atores (a luta aconteceu no servidor)');
  ok(fitaA?.pvpAmistoso?.venci === !fitaB?.pvpAmistoso?.venci, 'um venceu e o outro perdeu');
  ok(fitaA?.pvpAmistoso?.oponente?.nick === B.nick && fitaB?.pvpAmistoso?.oponente?.nick === A.nick, 'cada um vê o outro como oponente');
  const atualizada = await sA.esperar((m) => m.t === 'amigos' && m.dmAtualizada);
  const estadoFinal = JSON.parse(atualizada?.dmAtualizada?.texto ?? '{}');
  ok(estadoFinal.estado === 'aceito' && [A.nick, B.nick].includes(estadoFinal.venc), 'a linha da conversa vira "aceito" com o vencedor');
  const { rows: linhaDb } = await pool.query(`SELECT texto FROM dm_mensagens WHERE id = $1`, [dmA?.dm?.id]);
  ok(JSON.parse(linhaDb[0]?.texto ?? '{}').estado === 'aceito', '…e isso fica gravado no banco (sobrevive a um F5)');
  ok(await redis.exists(`pvpa:conv:${cid}`) === 0, 'o convite sumiu do Redis');
  const cdA = await redis.pttl(`pvpa:cd:${A.key}`);
  const cdB = await redis.pttl(`pvpa:cd:${B.key}`);
  ok(cdA > 4 * 60_000 && cdB > 4 * 60_000, 'os DOIS entram na espera de 5 min', `${cdA} / ${cdB}`);

  secao('A espera de 5 minutos');
  sD.limpar();
  sD.mandar({ t: 'amigo.pvp.convidar', amigoId: B.id });
  const eleEspera = await aviso(sD, 'amigos.pvpa.eleEspera');
  ok(!!eleEspera, 'chamar quem acabou de lutar: "Fulano fez um PvP amistoso recentemente"');
  ok(eleEspera?.params?.nick === B.nick && eleEspera?.params?.min >= 4, '…com o nick dele e os minutos que faltam', JSON.stringify(eleEspera?.params));
  sA.limpar();
  await dormir(5200);
  sA.mandar({ t: 'amigo.pvp.convidar', amigoId: D.id });
  ok(!!(await aviso(sA, 'amigos.pvpa.euEspero')), 'quem acabou de lutar também não desafia ninguém');

  secao('A fita guardada');
  sC.limpar();
  sC.mandar({ t: 'amigo.pvp.fita', conviteId: cid });
  ok(!!(await aviso(sC, 'amigos.pvpa.fitaExpirou')), 'quem não lutou não baixa a fita dos outros');
  sB.limpar();
  sB.mandar({ t: 'amigo.pvp.fita', conviteId: cid });
  const reprise = await sB.esperar((m) => m.t === 'amigos' && m.pvpAmistoso?.reprise);
  ok(!!reprise?.pvpAmistoso?.replay, 'quem lutou reassiste pela conversa');

  // ------------------------------------------------------------------ recusa e cancelamento
  secao('Recusa, cancelamento e expiração');
  sE.limpar(); sF.limpar();
  sE.mandar({ t: 'amigo.pvp.convidar', amigoId: F.id });
  const dmF = await sF.esperar((m) => m.t === 'amigos' && m.dm?.tipo === 3);
  const cid2 = JSON.parse(dmF?.dm?.texto ?? '{}').cid;
  sF.mandar({ t: 'amigo.pvp.responder', conviteId: cid2, aceitar: false });
  const recusou = await sE.esperar((m) => m.t === 'amigos' && m.pvpa?.recusou === F.nick);
  ok(!!recusou, 'quem desafiou fica sabendo da recusa');
  const upd2 = await sE.esperar((m) => m.t === 'amigos' && m.dmAtualizada);
  ok(JSON.parse(upd2?.dmAtualizada?.texto ?? '{}').estado === 'recusado', 'a linha vira "recusado"');
  ok(await redis.exists(`pvpa:cd:${E.key}`) === 0, 'recusa não gera espera');

  await dormir(5200);
  sE.limpar(); sF.limpar();
  sE.mandar({ t: 'amigo.pvp.convidar', amigoId: F.id });
  const dmF2 = await sF.esperar((m) => m.t === 'amigos' && m.dm?.tipo === 3);
  const cid3 = JSON.parse(dmF2?.dm?.texto ?? '{}').cid;
  ok(!!cid3 && cid3 !== cid2, 'depois da recusa dá para desafiar de novo');
  sE.mandar({ t: 'amigo.pvp.cancelar', conviteId: cid3 });
  const upd3 = await sF.esperar((m) => m.t === 'amigos' && m.dmAtualizada);
  ok(JSON.parse(upd3?.dmAtualizada?.texto ?? '{}').estado === 'cancelado', 'quem desafiou cancela, e a linha vira "cancelado"');
  sF.mandar({ t: 'amigo.pvp.responder', conviteId: cid3, aceitar: true });
  ok(!!(await aviso(sF, 'amigos.pvpa.sumiu')), 'aceitar um convite cancelado não faz nada');

  await dormir(5200);
  sE.limpar(); sF.limpar();
  sE.mandar({ t: 'amigo.pvp.convidar', amigoId: F.id });
  const dmF3 = await sF.esperar((m) => m.t === 'amigos' && m.dm?.tipo === 3);
  const cid4 = JSON.parse(dmF3?.dm?.texto ?? '{}').cid;
  await redis.pexpire(`pvpa:conv:${cid4}`, 1); // o prazo de 5 min "passou"
  await dormir(50);
  sF.mandar({ t: 'amigo.pvp.responder', conviteId: cid4, aceitar: true });
  ok(!!(await aviso(sF, 'amigos.pvpa.sumiu')), 'convite vencido não é aceito');
  ok(!sF.msgs.some((m) => m.pvpAmistoso), '…e não gera luta');

  sE.limpar();
  await dormir(5200);
  sE.mandar({ t: 'amigo.pvp.convidar', amigoId: G.id });
  ok(!!(await aviso(sE, 'amigos.pvpa.offline')), 'amigo offline não recebe desafio');

  secao('Amizade desfeita depois do convite');
  sD.limpar(); sB.limpar();
  // D e B são amigos e estão livres de espera? B lutou há pouco — então quem convida é D, e o
  // desafiado é A (também em espera). Para não depender das esperas, a dupla é D → F, amigos agora.
  await amigos(D, F);
  sD.mandar({ t: 'amigo.pvp.convidar', amigoId: F.id });
  const dmDF = await sF.esperar((m) => m.t === 'amigos' && m.dm?.tipo === 3 && m.dm.de === D.nick);
  const cid5 = JSON.parse(dmDF?.dm?.texto ?? '{}').cid;
  ok(!!cid5, 'convite criado');
  const [x, y] = D.id < F.id ? [D.id, F.id] : [F.id, D.id];
  await pool.query(`DELETE FROM amizades WHERE a_id = $1 AND b_id = $2`, [x, y]);
  sF.limpar();
  sF.mandar({ t: 'amigo.pvp.responder', conviteId: cid5, aceitar: true });
  ok(!!(await aviso(sF, 'amigos.naoEncontrado')), 'quem não é mais amigo não luta pelo convite antigo');
  await dormir(800);
  ok(!sF.msgs.some((m) => m.pvpAmistoso), '…nenhuma luta aconteceu');
  ok(await redis.exists(`pvpa:conv:${cid5}`) === 0, '…e o convite foi desfeito');
} catch (err) {
  falhas++;
  console.error('ERRO:', err);
} finally {
  for (const s of sockets) try { s.ws.close(); } catch {}
  await dormir(1500); // o sim grava a saída antes de a linha sumir
  await limpar();
  await pool.end();
  redis.disconnect();
}

console.log(`\n==============================================\n${falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`}`);
process.exit(falhas ? 1 : 0);
