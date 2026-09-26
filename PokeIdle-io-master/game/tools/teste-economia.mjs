// Teste de ECONOMIA pelo protocolo de verdade — o Market do NPC, a Loja e o cadeado do VIP.
//
// ### Por que pelo socket, e não chamando as funções
//
// `teste-loja.mjs` já prova as REGRAS da loja (preço, limite diário, "não acumula") chamando
// `validarCompra`/`aplicarEfeito` direto, sem servidor. E `teste-market-global.mjs` prova as
// transações do Mercado da Comunidade direto no Postgres.
//
// O que nenhum dos dois alcança é o que este arquivo existe para pegar: um bug de
// **time-of-check / time-of-use** no Market do NPC. Aquele caminho inteiro (`shop.buy`,
// `shop.sellItem`, `shop.sellAllItems`) mora dentro do `comandos` do sim, mexe em `p.gold` e
// `p.items` NA MEMÓRIA, e o risco é justamente a ordem em que várias mensagens são
// processadas. Chamar a função isolada não reproduz isso — é preciso jogar um lote de
// mensagens no mesmo socket e conferir o saldo depois.
//
// ### O que este teste prova
//
//   1. compra e venda batem no CENTAVO — nem a mais, nem a menos;
//   2. quantidade adulterada (0, negativa, fracionária, gigante, texto) não vira dinheiro;
//   3. duas vendas do MESMO lote, no mesmo lote de mensagens, pagam UMA vez;
//   4. `sellItem` + `sellAllItems` juntos não pagam o inventário duas vezes;
//   5. rajada de compras não deixa o ouro negativo;
//   6. o que o NPC vende, o NPC não recompra (nada de ouro infinito);
//   7. a Loja cobra o diamante e entrega o VIP;
//   8. **Lançar pokébola só liga com VIP** — a trava é do servidor, não do interruptor.
//
// Precisa do servidor no ar (`npm start`) e do Postgres (`npm run infra`).
//
//   node tools/teste-economia.mjs
import WebSocket from 'ws';
import { pool } from '../src/server/db.mjs';
import { itens } from '../src/server/content.mjs';
import { helloCom, sessaoPara } from './auth-teste.mjs';
import { criarMescladorDeEstado } from '../src/shared/estado-delta.mjs';

const URL = process.env.WS_URL ?? 'ws://localhost:8080';

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

// ------------------------------------------------------- o que vamos negociar
//
// Precisamos de um item que o NPC COMPRE (`precoDeVenda > 0`) e de um que ele VENDA (e
// portanto não recompre). Os dois são escolhidos do catálogo em vez de fixados por id: um
// número mágico aqui envelhece no primeiro `npm run fetch`.

const LOOT = [...itens.values()].find((i) => i.category === 'loot' && i.npcPrice > 0);
const PEDRA = [...itens.values()].find((i) => i.category === 'stone' && i.npcPrice === 0 && i.name === 'Fire Stone');
const POCAO = [...itens.values()].find((i) => i.category === 'heal' && i.npcPrice > 0);
const TOKEN = 70000; // o Bronze Boss Token, o único item avulso que o Market vende
if (!LOOT || !POCAO || !PEDRA) throw new Error('catálogo sem os itens de referência do teste');

const OURO_INICIAL = 1_000_000;
const DIAMANTES_INICIAIS = 50;
const QTD_LOOT = 40;

// ------------------------------------------------------------- a conta de teste
//
// Criada DIRETO no Postgres, com ouro, diamantes e um lote de loot na bolsa. Conseguir isso
// jogando levaria minutos de hunt, e o que está sendo testado não é a hunt.

const nick = `eco${Date.now() % 1000000}`;
await sessaoPara(nick);
const { rows } = await pool.query(
  `INSERT INTO players (nick, gold, diamonds, items, visual_ok)
   VALUES ($1, $2, $3, $4::jsonb, true) RETURNING id`,
  [nick, OURO_INICIAL, DIAMANTES_INICIAIS, JSON.stringify({ [LOOT.id]: QTD_LOOT, [POCAO.id]: 10 })],
);
const playerId = Number(rows[0].id);

// ------------------------------------------------------------------ o socket

let ws = null;
let estado = null;
let mesclar = criarMescladorDeEstado();
let sessao = null;
const avisos = [];

/** Espera o estado chegar (ou mudar). O sim manda snapshot no máximo 2×/s. */
async function esperar(pred, ms = 6000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (estado && pred(estado)) return true;
    await dormir(100);
  }
  return false;
}

async function conectar() {
  estado = null;
  // Um mesclador por CONEXAO: o welcome do socket novo reabre o quadro do zero.
  mesclar = criarMescladorDeEstado();
  sessao = await sessaoPara(nick);
  ws = new WebSocket(URL);
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome' || m.t === 'estado') estado = mesclar(m.estado);
    if (m.t === 'batalha') for (const e of m.ev) if (e.k === 'aviso') avisos.push(e.msg);
    if (m.t === 'erro') avisos.push(`erro: ${m.msg}`);
  });
  await new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });
  ws.send(JSON.stringify(helloCom(sessao)));
  if (!(await esperar((e) => e.nick))) throw new Error('o servidor não respondeu — está no ar?');
}

const manda = (o) => ws.send(JSON.stringify(o));

/** Uma "rodada": manda o lote e espera o servidor processar e responder. */
async function rodada(msgs) {
  avisos.length = 0;
  for (const m of msgs) manda(m);
  await dormir(1200);
}

await conectar();

// Treinador novo precisa de um starter antes de qualquer coisa: sem pokémon, metade dos
// comandos recusa por outro motivo e o teste mediria a coisa errada.
if (!estado.pokemons.length) {
  manda({ t: 'visual.set', genero: 'male', visual: {} });
  manda({ t: 'starter.pick', speciesId: 4 });
  await esperar((e) => e.pokemons.length > 0);
}

const ouro = () => estado.gold;
const temItem = (id) => estado.items[id] ?? 0;
const temBola = (id) => estado.balls[id] ?? 0;

console.log(`conta ${nick} (#${playerId}) · ouro ${ouro()} · ${QTD_LOOT}× ${LOOT.name} @ ${LOOT.npcPrice}`);

// ====================================================================== COMPRA
secao('Compra de pokébola — o valor tem de bater no ouro');
{
  const antes = ouro();
  const bolasAntes = temBola(1);
  await rodada([{ t: 'shop.buy', kind: 'ball', id: 1, qty: 10 }]);
  ok(ouro() === antes - 50, '10 Poké Balls custam exatamente 50', `${antes} → ${ouro()}`);
  ok(temBola(1) === bolasAntes + 10, 'e as 10 entram na bolsa', `${bolasAntes} → ${temBola(1)}`);
}

secao('Quantidade adulterada não vira dinheiro');
for (const qty of [0, -5, -1, 1.5, '10', 'abc', null, 1e12, Infinity, NaN]) {
  const antes = ouro();
  const bolasAntes = temBola(1);
  await rodada([{ t: 'shop.buy', kind: 'ball', id: 1, qty }]);
  const gasto = antes - ouro();
  const ganhou = temBola(1) - bolasAntes;
  // A regra é uma só, e vale para qualquer entrada: ou nada aconteceu, ou o que entrou foi
  // pago pelo preço cheio. Ouro criado do nada (gasto negativo) é o bug que importa.
  ok(
    gasto >= 0 && gasto === ganhou * 5 && ganhou >= 0,
    `qty=${String(qty)} → ${ganhou} bolas por ${gasto} de ouro`,
    `gasto ${gasto} para ${ganhou} bolas`,
  );
}

secao('Sem ouro, não compra');
{
  const antes = ouro();
  await rodada([{ t: 'shop.buy', kind: 'ball', id: 4, qty: 9999 }]); // 130 × 9999 = 1.299.870
  ok(ouro() === antes, 'compra impagável não debita nada', `${antes} → ${ouro()}`);
  ok(avisos.some((a) => /insuficiente/i.test(a)), 'e o jogador é avisado', avisos.join(' | '));
}

// ====================================================================== VENDA
secao('Venda de loot — o NPC paga o valor de catálogo');
{
  const antes = ouro();
  await rodada([{ t: 'shop.sellItem', id: LOOT.id, qty: 5 }]);
  ok(ouro() === antes + 5 * LOOT.npcPrice, `5× ${LOOT.name} pagam ${5 * LOOT.npcPrice}`, `${antes} → ${ouro()}`);
  ok(temItem(LOOT.id) === QTD_LOOT - 5, 'e saem da bolsa', `${temItem(LOOT.id)}`);
}

secao('O que o NPC VENDE, o NPC não recompra');
{
  const antes = ouro();
  const pocoesAntes = temItem(POCAO.id);
  await rodada([{ t: 'shop.sellItem', id: POCAO.id, qty: 10 }]);
  ok(ouro() === antes, `${POCAO.name} não gera ouro`, `${antes} → ${ouro()}`);
  ok(temItem(POCAO.id) === pocoesAntes, 'e continua na bolsa', `${temItem(POCAO.id)}`);
}
{
  // O Boss Token não se compra nem se revende ao NPC — preço só no Mercado da Comunidade.
  const tokenItem = itens.get(TOKEN);
  ok(tokenItem && tokenItem.npcPrice === 0, 'Bronze Boss Token sem npcPrice (preço só entre jogadores)');
  const antes = ouro();
  await rodada([{ t: 'shop.buy', kind: 'item', id: TOKEN, qty: 1 }]);
  ok(ouro() === antes, 'Bronze Boss Token não está à venda no Market', `${antes} → ${ouro()}`);
  await pool.query(
    `UPDATE players SET items = items || $2::jsonb WHERE id = $1`,
    [playerId, JSON.stringify({ [TOKEN]: 1 })],
  );
  ws.close();
  await dormir(800);
  await conectar();
  await esperar((e) => (e.items[TOKEN] ?? 0) >= 1, 6000);
  await rodada([{ t: 'shop.sellItem', id: TOKEN, qty: 1 }]);
  ok(ouro() === antes, 'revender ao NPC não paga nada', `${ouro()} → ${ouro()}`);
  ok((estado?.items?.[TOKEN] ?? 0) >= 1, 'o token continua na bolsa', `${estado?.items?.[TOKEN]}`);
  await rodada([{ t: 'shop.sellAllItems' }]);
  ok(ouro() === antes, 'vender tudo também não manda o token pro NPC', `${ouro()}`);
  ok((estado?.items?.[TOKEN] ?? 0) >= 1, 'o token sobrevive ao vender tudo', `${estado?.items?.[TOKEN]}`);
}
{
  ok(PEDRA.npcPrice === 0, `${PEDRA.name} sem npcPrice (só Mercado da Comunidade)`);
  await pool.query(
    `UPDATE players SET items = items || $2::jsonb WHERE id = $1`,
    [playerId, JSON.stringify({ [PEDRA.id]: 3 })],
  );
  ws.close();
  await dormir(800);
  await conectar();
  await esperar((e) => (e.items[PEDRA.id] ?? 0) >= 3, 6000);
  const antes = ouro();
  await rodada([{ t: 'shop.sellItem', id: PEDRA.id, qty: 1 }]);
  ok(ouro() === antes, 'pedra de evolução não vende ao NPC', `${ouro()} → ${ouro()}`);
  ok((estado?.items?.[PEDRA.id] ?? 0) >= 3, 'a pedra continua na bolsa', `${estado?.items?.[PEDRA.id]}`);
  await rodada([{ t: 'shop.sellAllItems' }]);
  ok(ouro() === antes, 'vender tudo também não manda pedra pro NPC', `${ouro()}`);
  ok((estado?.items?.[PEDRA.id] ?? 0) >= 3, 'a pedra sobrevive ao vender tudo', `${estado?.items?.[PEDRA.id]}`);
}

secao('Vender mais do que se tem');
{
  const antes = ouro();
  const tinha = temItem(LOOT.id);
  await rodada([{ t: 'shop.sellItem', id: LOOT.id, qty: 9999 }]);
  ok(
    ouro() === antes + tinha * LOOT.npcPrice,
    `pede 9999, vende os ${tinha} que existem`,
    `esperado +${tinha * LOOT.npcPrice}, veio +${ouro() - antes}`,
  );
  ok(temItem(LOOT.id) === 0, 'e a bolsa fica zerada', `${temItem(LOOT.id)}`);
}

// ============================================================ TIME-OF-CHECK/USE
//
// A partir daqui é o ponto do arquivo. Cada bloco manda VÁRIAS mensagens sem esperar
// resposta entre elas — é a única forma de exercitar a ordem de processamento do sim.

/**
 * Recoloca `n` unidades do loot na bolsa — e a ORDEM aqui é o detalhe que faz a coisa
 * funcionar.
 *
 * O inventário vive na MEMÓRIA do sim; um UPDATE no Postgres com a sessão aberta não o
 * alcança e, pior, é apagado pelo flush seguinte, que grava a memória por cima. Então:
 * desconecta (o `sair` do sim faz flush IMEDIATO), só então escreve, e reconecta para o
 * `entrar` reler a linha.
 *
 * Sem isto o teste rodava a rajada de TOCTOU com estoque zero e passava sem provar nada —
 * que é o pior tipo de teste verde.
 */
async function reporLoot(n) {
  ws.close();
  await dormir(1200); // o flush do disconnect é imediato, mas é uma ida ao banco
  await pool.query(`UPDATE players SET items = items || $2::jsonb WHERE id = $1`, [
    playerId,
    JSON.stringify({ [LOOT.id]: n }),
  ]);
  await conectar();
  if (!(await esperar((e) => (e.items[LOOT.id] ?? 0) >= n, 6000))) {
    throw new Error(`a reposição de ${n}× ${LOOT.name} não chegou à sessão`);
  }
}

secao('TOCTOU — vender o mesmo lote duas vezes no mesmo instante');
{
  // Sem esperar entre as duas: se `shop.sellItem` lesse a quantidade e só depois debitasse,
  // as duas leriam 20 e o jogador receberia por 40.
  await reporLoot(20);
  const antes = ouro();
  const estoque = temItem(LOOT.id);
  ok(estoque >= 20, `a bolsa tem ${estoque}× ${LOOT.name} para a rajada`);
  await rodada([
    { t: 'shop.sellItem', id: LOOT.id, qty: estoque },
    { t: 'shop.sellItem', id: LOOT.id, qty: estoque },
    { t: 'shop.sellItem', id: LOOT.id, qty: estoque },
  ]);
  ok(
    ouro() === antes + estoque * LOOT.npcPrice,
    `3 vendas simultâneas de ${estoque} pagam UMA vez`,
    `esperado +${estoque * LOOT.npcPrice}, veio +${ouro() - antes}`,
  );
  ok(temItem(LOOT.id) === 0, 'e o estoque não fica negativo', `${temItem(LOOT.id)}`);
}

secao('TOCTOU — sellItem e sellAllItems na mesma rajada');
{
  await reporLoot(12);
  const antes = ouro();
  const estoque = temItem(LOOT.id);
  ok(estoque >= 12, `a bolsa tem ${estoque}× ${LOOT.name} para a rajada`);
  await rodada([
    { t: 'shop.sellItem', id: LOOT.id, qty: estoque },
    { t: 'shop.sellAllItems' },
    { t: 'shop.sellItem', id: LOOT.id, qty: estoque },
  ]);
  // Só o loot tem valor de venda; a poção que sobrou na bolsa vale 0 e não entra na conta.
  ok(
    ouro() === antes + estoque * LOOT.npcPrice,
    'o inventário é pago uma vez só',
    `esperado +${estoque * LOOT.npcPrice}, veio +${ouro() - antes}`,
  );
}

secao('TOCTOU — rajada de compras não deixa o ouro negativo');
{
  // Vinte compras de 130×500 = 65.000 cada. Com o ouro atual só algumas cabem; o resto tem de
  // ser recusado, e a soma do que entrou tem de bater exatamente com o que saiu.
  const antes = ouro();
  const bolasAntes = temBola(4);
  const lote = Array.from({ length: 20 }, () => ({ t: 'shop.buy', kind: 'ball', id: 4, qty: 500 }));
  await rodada(lote);
  const gasto = antes - ouro();
  const compradas = temBola(4) - bolasAntes;
  ok(ouro() >= 0, 'o ouro nunca fica negativo', `${ouro()}`);
  ok(gasto === compradas * 130, 'tudo que entrou foi pago', `gasto ${gasto} para ${compradas} bolas`);
  ok(compradas % 500 === 0, 'e nenhuma compra saiu pela metade', `${compradas} bolas`);
}

// ================================================================= LOJA E VIP
secao('Loja de Diamantes — a compra do VIP');
{
  const diamAntes = estado.diamonds;
  ok(diamAntes >= 10, `a conta tem ${diamAntes} 💎 para gastar`);
  ok(!estado.loja.vip, 'e começa SEM VIP');

  await rodada([{ t: 'loja.comprar', id: 'vip30' }]);
  await esperar((e) => e.loja.vip, 4000);
  ok(estado.loja.vip, 'comprar vip30 liga o VIP', avisos.join(' | '));
  ok(estado.diamonds === diamAntes - 10, 'e cobra os 10 💎', `${diamAntes} → ${estado.diamonds}`);

  const dias = Math.round((estado.loja.vipAte - Date.now()) / 86400000);
  ok(dias === 30, 'com 30 dias de prazo', `${dias} dias`);
}

secao('Boost — o carimbo de expiração chega na tela');
{
  await rodada([{ t: 'loja.comprar', id: 'boost_xp' }]);
  await esperar((e) => e.loja.boosts?.xp > Date.now(), 4000);
  const falta = (estado.loja.boosts?.xp ?? 0) - Date.now();
  ok(falta > 0, 'o XP Boost fica ativo', `${falta}ms`);
  ok(Math.abs(falta - 3600_000) < 60_000, 'e o prazo é de 1 hora', `${Math.round(falta / 60000)} min`);

  // "Não acumula": o segundo pacote ESTENDE em vez de dobrar o multiplicador.
  await rodada([{ t: 'loja.comprar', id: 'boost_xp_2h' }]);
  await dormir(600);
  const falta2 = (estado.loja.boosts?.xp ?? 0) - Date.now();
  ok(Math.abs(falta2 - 3 * 3600_000) < 120_000, 'comprar de novo ESTENDE (1h + 2h)', `${Math.round(falta2 / 60000)} min`);
}

secao('Pacote de Suprimentos — uma vez por semana');
{
  const antes = temBola(5);
  await rodada([{ t: 'loja.comprar', id: 'supplypack' }]);
  await esperar((e) => (e.balls[5] ?? 0) > antes, 4000);
  ok(temBola(5) === antes + 1000, 'a primeira compra dá 1000 Beast Balls', `${antes} → ${temBola(5)}`);

  await rodada([{ t: 'loja.comprar', id: 'supplypack' }]);
  ok(temBola(5) === antes + 1000, 'a segunda é recusada na mesma semana', `${temBola(5)}`);
  ok(avisos.some((a) => /7 dias/.test(a)), 'com o aviso do prazo', avisos.join(' | '));
}

// ======================================================= o cadeado do Auto-Catch
secao('Lançar pokébola é recurso de VIP');
{
  // Com VIP ligado, o interruptor obedece.
  await rodada([{ t: 'auto.set', autoBallSemParar: true, ballIds: [1], autoRevive: false, autoPotion: false }]);
  ok(estado.automation.autoBallSemParar === true, 'com VIP, sem parar liga');
  ok(!estado.automation.autoBallAteCapturar, 'e não liga os dois modos juntos');

  await rodada([{ t: 'auto.set', autoBallAteCapturar: true, autoBallSemParar: true, ballIds: [1] }]);
  ok(estado.automation.autoBallAteCapturar === true, 'dois modos ligados: fica só até capturar');
  ok(!estado.automation.autoBallSemParar, 'sem parar cede quando os dois chegam juntos');

  // E sem VIP, não. Derrubar a assinatura pelo banco não bastaria (o sim tem `vipAte` em
  // memória); o caminho honesto é reconectar depois de zerar a coluna, que é exatamente o
  // que acontece na vida real quando o prazo vence entre duas sessões.
  ws.close();
  await dormir(1200);
  await pool.query(`UPDATE players SET vip_ate = 0 WHERE id = $1`, [playerId]);
  await conectar();
  ok(!estado.loja.vip, 'a assinatura venceu', `vipAte=${estado.loja.vipAte}`);

  await rodada([{ t: 'auto.set', autoBallSemParar: true, ballIds: [1], autoRevive: false, autoPotion: false }]);
  ok(estado.automation.autoBallSemParar === false, 'sem VIP, o servidor RECUSA ligar', `${estado.automation.autoBallSemParar}`);
  ok(avisos.some((a) => /VIP/i.test(a)), 'e explica o porquê', avisos.join(' | '));

  // O resto das automações continua livre para todo mundo.
  await rodada([
    { t: 'auto.set', autoBallSemParar: false, autoBallAteCapturar: false, ballIds: [1], autoRevive: true, autoPotion: true, hpLimiar: 0.6, reviveIds: [LOOT.id] },
  ]);
  ok(estado.automation.autoRevive === true, 'revive continua livre');
  ok(estado.automation.autoPotion === true, '+HP continua livre');
  ok(estado.automation.hpLimiar === 0.6, 'e o limiar de HP é gravado', `${estado.automation.hpLimiar}`);
  ok(
    JSON.stringify(estado.automation.reviveIds) === JSON.stringify([LOOT.id]),
    'a lista de itens preferidos volta como veio',
    JSON.stringify(estado.automation.reviveIds),
  );

  await rodada([{ t: 'auto.set', autoBallSemParar: false, autoRevive: true, autoPotion: true, hpLimiar: 0.99 }]);
  ok(estado.automation.hpLimiar === 1, 'limiar fora do passo arredonda para o degrau mais perto', `${estado.automation.hpLimiar}`);

  await rodada([{ t: 'auto.set', autoPotion: true, potionIds: ['x', -3, 7.5, 12, 12, 12] }]);
  ok(
    JSON.stringify(estado.automation.potionIds) === JSON.stringify([12]),
    'lixo na lista de itens é filtrado (e a repetição, removida)',
    JSON.stringify(estado.automation.potionIds),
  );

  ws.close();
}

// ------------------------------------------------------------------ limpeza
await pool.query(`DELETE FROM players WHERE id = $1`, [playerId]).catch(() => {});
await pool.end();

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
