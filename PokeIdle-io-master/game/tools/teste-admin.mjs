// O painel de lucro: as três travas, exercitadas contra o servidor de verdade.
//
//   ADMIN_EMAILS=... CARTEIRAS_LUCRO=nome:endereco node tools/teste-admin.mjs
//
// Este é o teste que mais importa do repositório, e não é por ser complicado — é porque as
// rotas de `/admin/` são as únicas que podem TIRAR USDT da tesouraria. Tudo aqui pergunta a
// mesma coisa de jeitos diferentes: **um pedido que não deveria mover dinheiro consegue mover?**
//
// Ele fala HTTP direto, sem navegador: a tela não participa de nenhuma decisão, então testar
// pela tela testaria a coisa errada. Quem manda `curl` na mão passa exatamente por aqui.
import { pool } from '../src/server/db.mjs';
import { assinarSessao, migrar as migrarAuth } from '../src/server/auth.mjs';
import { migrar as migrarAdmin } from '../src/server/admin.mjs';

const BASE = process.argv[2] ?? 'http://localhost:8080';
const ADMIN = (process.env.ADMIN_EMAILS ?? '').split(',')[0].trim();

if (!ADMIN) {
  console.error('defina ADMIN_EMAILS — sem ele o painel não existe e não há o que testar');
  process.exit(1);
}

const falhas = [];
const ok = (passou, oque, detalhe = '') => {
  console.log(`${passou ? '  ok  ' : ' FALHA'}  ${oque}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!passou) falhas.push(oque);
};

const pedir = async (rota, corpo) => {
  const r = await fetch(`${BASE}/admin/${rota}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, dados: await r.json().catch(() => ({})) };
};

await migrarAuth();
await migrarAdmin();

/** Uma conta com e-mail à escolha, e o token assinado dela. */
async function contaCom(email) {
  const nick = `t${Date.now() % 100000}${Math.floor(Math.random() * 900 + 100)}`;
  const { rows } = await pool.query(
    `INSERT INTO accounts (nick, email, senha_hash, provedor, email_ok)
     VALUES ($1, $2, 'x', 'local', true)
     ON CONFLICT (email) DO UPDATE SET nick = accounts.nick
     RETURNING id, nick`,
    [nick, email.toLowerCase()],
  );
  const c = rows[0];
  return {
    id: c.id,
    // O `await` não é enfeite: `assinarSessao` virou async quando passou a ler a ÉPOCA da conta
    // (a revogação de sessão), e sem ele o que ia daqui para o `fetch` era uma Promise — que
    // `JSON.stringify` serializa como `{}`. O token chegava vazio, o painel respondia 404 ao
    // próprio admin e o arquivo parava na primeira trava, sem chegar a testar nenhuma das três.
    token: await assinarSessao({ nick: c.nick, contaId: Number(c.id), provedor: 'local' }),
  };
}

console.log(`PAINEL DE LUCRO — ${BASE}\n${'='.repeat(46)}`);

// ------------------------------------------------------- trava 1: QUEM
console.log('\nquem entra');

ok((await pedir('painel', {})).status === 404, 'sem token nenhum: 404');
ok((await pedir('painel', { token: 'nao-assinado' })).status === 404, 'token inventado: 404');

const estranho = await contaCom(`estranho${Date.now() % 100000}@exemplo.com`);
const r1 = await pedir('painel', { token: estranho.token });
ok(r1.status === 404, 'conta VÁLIDA que não é admin: 404', `veio ${r1.status}`);
ok(r1.dados.erro === 'não encontrado',
  'e a mensagem não confirma que existe painel', JSON.stringify(r1.dados));

const admin = await contaCom(ADMIN);
const r2 = await pedir('painel', { token: admin.token });
ok(r2.status === 200, `conta admin (${ADMIN}): 200`, `veio ${r2.status}`);

if (r2.status !== 200) {
  console.log('\nsem painel não dá para testar o resto.');
  await pool.end();
  process.exit(1);
}

// -------------------------------------------------------- os números
console.log('\nos números');

const p = r2.dados;
ok(typeof p.crypto?.caixa === 'number', 'devolve caixa');
ok(typeof p.crypto?.passivo === 'number', 'devolve passivo');
ok(p.crypto.lucro === p.crypto.caixa - p.crypto.passivo, 'lucro = caixa − passivo');
ok(p.crypto.sobra >= 0, 'a sobra nunca é negativa', String(p.crypto.sobra));
ok(p.crypto.sobra <= Math.max(0, p.crypto.caixa - p.crypto.passivo * p.crypto.colchao) + 1e-9,
  `a sobra respeita o colchão de ${p.crypto.colchao}×`, String(p.crypto.sobra));
ok(Array.isArray(p.fiat?.porMetodo), 'devolve o fiat separado por método/provedor');
ok(Array.isArray(p.fiat?.recentes), 'devolve os pagamentos recentes com nick');
ok(p.email === ADMIN, 'devolve de quem é a sessão', p.email);

// -------------------------------------------------------- varredura
console.log('\nvarredura manual');

ok(typeof p.varredura?.disponivel === 'boolean', 'devolve se a varredura está disponível');

const semAuthVarredura = await pedir('gemas/varredura', { token: estranho.token });
ok(semAuthVarredura.status === 404, 'não-admin não dispara varredura', String(semAuthVarredura.status));

if (!process.env.CHAIN_REDE) {
  const simulada = await pedir('gemas/varredura', { token: admin.token });
  ok(simulada.status === 400 && /simulada|CHAIN_REDE/i.test(simulada.dados.erro ?? ''),
    'com rede simulada, recusa varredura em vez de fingir', simulada.dados.erro);
}

// -------------------------------------------------- trava 2: PARA ONDE
console.log('\npara onde o dinheiro pode ir');

const forasteira = await pedir('colher', {
  token: admin.token,
  carteira: 'AtacanteAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  usdt: 0.01,
});
ok(forasteira.status === 400 && /autorizada/i.test(forasteira.dados.erro ?? ''),
  'carteira fora da lista é recusada', forasteira.dados.erro);

ok(Array.isArray(p.carteiras), 'o painel devolve a lista de carteiras autorizadas');
const daLista = p.carteiras[0]?.endereco;

// ------------------------------------------------------ trava 3: QUANTO
console.log('\nquanto pode sair');

if (daLista) {
  const demais = await pedir('colher', { token: admin.token, carteira: daLista, usdt: 1e9 });
  ok(demais.status === 400, 'valor absurdo é recusado', demais.dados.erro);
  ok(!/sucesso|assinatura/i.test(JSON.stringify(demais.dados)), 'e nada foi enviado');

  const zero = await pedir('colher', { token: admin.token, carteira: daLista, usdt: 0 });
  ok(zero.status === 400, 'valor zero é recusado', zero.dados.erro);

  const negativo = await pedir('colher', { token: admin.token, carteira: daLista, usdt: -5 });
  ok(negativo.status === 400, 'valor negativo é recusado', negativo.dados.erro);

  // A guarda mais fácil de esquecer: sem `CHAIN_REDE` o `criarChain` devolve a rede SIMULADA,
  // e um "enviado com sucesso" que não moveu nada é pior do que um erro.
  if (!process.env.CHAIN_REDE) {
    const simulada = await pedir('colher', { token: admin.token, carteira: daLista, usdt: 0.000001 });
    ok(simulada.status === 400 && /simulada|CHAIN_REDE/i.test(simulada.dados.erro ?? ''),
      'com rede simulada, recusa em vez de fingir que enviou', simulada.dados.erro);
  }
} else {
  console.log('  (sem CARTEIRAS_LUCRO configurada: travas de valor não exercitadas)');
}

// ---------------------------------------------------- tags do chat
console.log('\ntags do chat');

ok(Array.isArray(p.cargos), 'devolve a lista de tags do chat');

const nickTag = `tag${Date.now() % 100000}`;
await pool.query(`INSERT INTO players (nick) VALUES ($1)`, [nickTag]);

const semPlayer = await pedir('cargos/definir', {
  token: admin.token,
  nick: 'zzz_inexistente_xyz',
  cargo: 'moderador',
});
ok(semPlayer.status === 400 && /não encontrado/i.test(semPlayer.dados.erro ?? ''),
  'nick inexistente é recusado', semPlayer.dados.erro);

const tagOk = await pedir('cargos/definir', {
  token: admin.token,
  nick: nickTag,
  cargo: 'streamer',
});
ok(tagOk.status === 200 && tagOk.dados.cargo === 'streamer', 'atribui tag streamer', JSON.stringify(tagOk.dados));

const painel2 = await pedir('painel', { token: admin.token });
ok(painel2.dados.cargos?.some((c) => c.nick === nickTag && c.cargo === 'streamer'),
  'a tag aparece no painel');

const troca = await pedir('cargos/definir', {
  token: admin.token,
  nick: nickTag,
  cargo: 'moderador',
});
ok(troca.status === 200 && troca.dados.cargo === 'moderador', 'troca tag para moderador');

const semAuth = await pedir('cargos/definir', {
  token: estranho.token,
  nick: nickTag,
  cargo: 'moderador',
});
ok(semAuth.status === 404, 'não-admin não atribui tag', String(semAuth.status));

const remove = await pedir('cargos/remover', { token: admin.token, nick: nickTag });
ok(remove.status === 200, 'remove tag');

await pool.query(`DELETE FROM chat_cargos WHERE lower(nick) = lower($1)`, [nickTag]);
await pool.query(`DELETE FROM players WHERE nick = $1`, [nickTag]);

// ------------------------------------------------------------- apagar conta
console.log('\napagar conta');

const vitima = await contaCom(`apagar${Date.now()}@exemplo.com`);
const { rows: vrows } = await pool.query(`SELECT nick FROM accounts WHERE id = $1`, [vitima.id]);
const nickVitima = vrows[0].nick;
await pool.query(`INSERT INTO players (nick) VALUES ($1)`, [nickVitima]);

ok(
  (await pedir('usuarios/apagar', { token: admin.token, nick: ADMIN })).status === 400,
  'não apaga a própria conta admin',
);
const apagou = await pedir('usuarios/apagar', { token: admin.token, nick: nickVitima });
ok(apagou.status === 200 && apagou.dados.apagada, 'apaga conta de teste', JSON.stringify(apagou.dados));
const { rows: sobrou } = await pool.query(`SELECT 1 FROM accounts WHERE id = $1`, [vitima.id]);
ok(!sobrou.length, 'conta sumiu do banco');
const { rows: pjApagado } = await pool.query(
  `SELECT 1 FROM players WHERE lower(nick) = lower($1)`,
  [nickVitima],
);
ok(!pjApagado.length, 'personagem sumiu do banco');

// ------------------------------------------------------------- limpeza
await pool.query(`DELETE FROM accounts WHERE id = $1`, [estranho.id]);
await pool.end();

console.log(`\n${'='.repeat(46)}`);
console.log(falhas.length ? `${falhas.length} FALHA(S)` : 'todas as travas seguraram');
process.exit(falhas.length ? 1 : 0);
