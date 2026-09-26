// Vote & Ganhe + Calculadora — as duas partes que dá para testar sem banco nem rede.
//
// O que este teste existe para pegar:
//
//  1. A NOTA refletir FORÇA de combate (soma de stats), não percentil de sorteio.
//     P5 com IV baixo deve passar P3 com IV alto se os stats finais forem maiores.
//
//  2. As tabelas do `shared/nota-pokemon.mjs` DIVERGIREM das do servidor.
//
//  3. A assinatura do webhook aceitar o que não devia — corpo trocado, carimbo velho,
//     segredo errado. É o que separa "o TopIdle mandou" de "alguém descobriu a URL".
//
//   node tools/teste-topidle.mjs
import { createHmac } from 'node:crypto';
import {
  BANDAS_QUALIDADE, IV_MAX, IV_MIN, QUALIDADE_MAX, QUALIDADE_MIN,
  faixaDaNota, notaPokemon, percentilPotencia, percentilQualidade,
} from '../src/shared/nota-pokemon.mjs';
import { POTENCIAS } from '../src/server/content.mjs';
import {
  DIAMANTES_POR_PAR, FOLGA_MS, IDENTIFICADOR_OK, MAX_VOTANTES_POR_JOGADOR, RECARGA_EFETIVA_MS,
  RECARGA_MS, VOTOS_POR_DIAMANTE, chaveVotante, diaUtc, normalizarEvento, proximoVotoEm, urlDeVoto,
} from '../src/server/game/topidle.mjs';
import { MOTIVO, MOTIVOS_QUE_EMITEM } from '../src/server/game/diamantes.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);
const perto = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('Vote & Ganhe + Calculadora\n==========================');

// ------------------------------------------------------------ tabelas coladas

secao('As tabelas do módulo compartilhado batem com as do servidor');
{
  const formulas = JSON.parse(
    await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../public/data/index/formulas.json', import.meta.url), 'utf8')),
  );
  const doServidor = formulas.qualidade.bandas;
  ok(doServidor.length === BANDAS_QUALIDADE.length,
     'mesmo número de bandas de qualidade', `${doServidor.length} vs ${BANDAS_QUALIDADE.length}`);
  ok(doServidor.every((b, i) => b.min === BANDAS_QUALIDADE[i].min
      && b.max === BANDAS_QUALIDADE[i].max && b.chance === BANDAS_QUALIDADE[i].chance),
     'e cada banda é idêntica (min, max e chance)');

  const soma = BANDAS_QUALIDADE.reduce((s, b) => s + b.chance, 0);
  ok(perto(soma, 100, 1e-6), 'as chances somam 100', String(soma));

  ok(POTENCIAS.length === 5, 'cinco potências no servidor');
  ok(percentilPotencia(1) < percentilPotencia(2)
    && percentilPotencia(2) < percentilPotencia(3)
    && percentilPotencia(3) < percentilPotencia(4)
    && percentilPotencia(4) < percentilPotencia(5),
     'e a escala da nota preserva a ordem delas');
}

// ------------------------------------------------------------------ percentis

secao('Percentis');
{
  ok(percentilQualidade(QUALIDADE_MIN) === 0, 'a pior qualidade possível é percentil 0');
  ok(perto(percentilQualidade(QUALIDADE_MAX), 1, 1e-6), 'e a melhor é 1');
  // 5% + 5% caem abaixo de 1,00 — é a banda "Fraca" inteira.
  ok(perto(percentilQualidade(1.0), 0.10, 1e-6),
     'qualidade 1,00 deixa 10% para trás (as duas bandas fracas)', String(percentilQualidade(1.0)));
  ok(percentilQualidade(1.05) > percentilQualidade(1.0),
     'e dentro da banda a interpolação é monótona');
  // O vão de 1,6 a 1,7 não tem banda: nada é sorteado ali.
  ok(percentilQualidade(1.65) === percentilQualidade(1.6),
     'o vão de 1,6–1,7 não acumula chance nenhuma');
}

// ------------------------------------------------------------------ a nota

secao('A nota mede força (stats), não sorteio');
{
  const pior = notaPokemon({ iv: IV_MIN, qualidade: QUALIDADE_MIN, potencia: 1, shiny: false });
  const melhor = notaPokemon({ iv: IV_MAX, qualidade: QUALIDADE_MAX, potencia: 5, shiny: true });
  ok(perto(melhor.nota, 10, 0.01), 'o nascimento perfeito dá 10', String(melhor.nota));
  ok(pior.nota < 1, 'e o pior dá menos de 1', String(pior.nota));
  ok(melhor.faixa === 'divino' && pior.faixa === 'extremamente-fraco', 'com as faixas certas nas duas pontas');

  const p5Fraco = notaPokemon({ iv: 73, qualidade: 1.17, potencia: 5, shiny: false });
  const p3Forte = notaPokemon({ iv: 126, qualidade: 1.60, potencia: 3, shiny: false });
  ok(p5Fraco.nota > p3Forte.nota,
     'P5 fraco passa P3 forte — a nota segue stats, não percentil de sorteio',
     `${p5Fraco.nota} vs ${p3Forte.nota}`);

  const mediano = notaPokemon({ iv: 99, qualidade: 1.1, potencia: 1, shiny: false });
  ok(mediano.nota >= 1.5 && mediano.nota <= 3.5,
     'sorteio mediano comum cai na faixa baixa', String(mediano.nota));

  const tetoComum = notaPokemon({ iv: IV_MAX, qualidade: QUALIDADE_MAX, potencia: 5, shiny: false });
  ok(tetoComum.nota >= 6 && tetoComum.nota <= 7,
     'comum perfeito sem shiny fica perto de 6–7 (escala relativa ao shiny ×3)', String(tetoComum.nota));

  const elegivelMercado = notaPokemon({ iv: 134, qualidade: 1.573, potencia: 5, shiny: false });
  ok(elegivelMercado.nota >= 3.5,
     'nota 3,5+ no mercado sem shiny é possível (ex.: P5)', String(elegivelMercado.nota));

  const topo = notaPokemon({ iv: 192, qualidade: 1.5, potencia: 5, shiny: true });
  ok(topo.nota >= 8.5,
     'nota 8,5+ exige shiny ou sorteio muito alto', String(topo.nota));

  let monotona = true;
  for (let iv = IV_MIN; iv <= IV_MAX; iv += 6) {
    for (const q of [0.85, 1.0, 1.15, 1.35, 1.55, 1.8]) {
      for (let p = 1; p <= 5; p++) {
        const base = notaPokemon({ iv, qualidade: q, potencia: p, shiny: false }).nota;
        if (iv + 6 <= IV_MAX && notaPokemon({ iv: iv + 6, qualidade: q, potencia: p, shiny: false }).nota < base) monotona = false;
        if (p < 5 && notaPokemon({ iv, qualidade: q, potencia: p + 1, shiny: false }).nota < base) monotona = false;
        if (notaPokemon({ iv, qualidade: q, potencia: p, shiny: true }).nota < base) monotona = false;
      }
    }
  }
  ok(monotona, 'subir qualquer eixo nunca abaixa a nota');

  const absurdoComum = notaPokemon({ iv: 9999, qualidade: 99, potencia: 42, shiny: false });
  ok(absurdoComum.nota >= 6 && absurdoComum.nota <= 7,
     'comum absurdo é preso no teto sem shiny (~6,4 com escala ×3)', String(absurdoComum.nota));
  const absurdoShiny = notaPokemon({ iv: 9999, qualidade: 99, potencia: 42, shiny: true });
  ok(absurdoShiny.nota === 10, 'shiny absurdo é preso no teto 10', String(absurdoShiny.nota));
  const vazio = notaPokemon({});
  ok(Number.isFinite(vazio.nota), 'e campo vazio devolve número, não NaN', String(vazio.nota));
}

secao('As faixas de cor');
{
  ok(faixaDaNota(0) === 'extremamente-fraco' && faixaDaNota(1) === 'extremamente-fraco', '0–1 é extremamente fraco');
  ok(faixaDaNota(1.001) === 'fraco' && faixaDaNota(2) === 'fraco', '1–2 é fraco');
  ok(faixaDaNota(3) === 'mediano' && faixaDaNota(4) === 'razoavel', '3–4 mediano/razoável');
  ok(faixaDaNota(5) === 'bom' && faixaDaNota(6) === 'forte', '5–6 bom/forte');
  ok(faixaDaNota(7) === 'poderoso' && faixaDaNota(8) === 'mitico', '7–8 poderoso/mítico');
  ok(faixaDaNota(9) === 'legendario' && faixaDaNota(10) === 'divino', '9–10 lendário/divino');
}

// ------------------------------------------------------------ regra do voto

secao('Regra do voto');
{
  ok(DIAMANTES_POR_PAR === 1 && VOTOS_POR_DIAMANTE === 2, 'um diamante a cada dois votos');
  ok(RECARGA_MS === 24 * 60 * 60 * 1000, 'a recarga é de 24 h, como o TopIdle anuncia');
  ok(RECARGA_EFETIVA_MS === RECARGA_MS - FOLGA_MS && FOLGA_MS > 0,
     'e o servidor cobra um pouco menos, para nunca recusar um voto honesto no limite');
  // A conta que importa: votos por diamante × dias por voto = dias por diamante.
  ok(VOTOS_POR_DIAMANTE === 2, 'o teto de emissão é um diamante a cada DOIS dias por jogador');

  const base = new Date('2026-08-13T17:00:00Z');
  ok(proximoVotoEm(base).getTime() === base.getTime() + RECARGA_EFETIVA_MS,
     'e a data do próximo voto sai do instante do voto que contou');
  ok(MAX_VOTANTES_POR_JOGADOR === 2, 'e no máximo duas contas do TopIdle votam no mesmo jogador');
  ok(MOTIVOS_QUE_EMITEM.has(MOTIVO.VOTO), 'o motivo do voto emite diamante');

  ok(urlDeVoto('meu-jogo', 'Fasi') === 'https://topidle.com/jogo/meu-jogo?playerIdentifier=Fasi',
     'a URL de voto leva o nick preenchido');
  ok(urlDeVoto('meu-jogo', '') === 'https://topidle.com/jogo/meu-jogo',
     'e sem nick não inventa parâmetro vazio');

  ok(IDENTIFICADOR_OK.test('Fasi_1') && !IDENTIFICADOR_OK.test('ab') && !IDENTIFICADOR_OK.test('com espaço'),
     'o identificador aceito tem a forma do nick');

  ok(diaUtc(Date.parse('2026-08-13T23:59:59Z')) === '2026-08-13'
    && diaUtc(Date.parse('2026-08-14T00:00:01Z')) === '2026-08-14',
     'o recorte do teto diário é UTC');
}

secao('Normalização do evento');
{
  const ev = normalizarEvento({ eventId: 'e1', playerIdentifier: 'Fasi', votedAt: '2026-08-13T10:00:00Z' });
  ok(ev?.eventId === 'e1' && ev.identificador === 'Fasi', 'lê o formato do webhook');

  const porEmail = normalizarEvento({ id: 'e2', googleEmail: 'A@B.COM' });
  ok(porEmail?.eventId === 'e2' && porEmail.email === 'a@b.com',
     'aceita o formato da API e normaliza o e-mail');

  ok(normalizarEvento({ eventId: 'e3', playerIdentifier: 'x' })?.identificador === '',
     'identificador fora da forma do nick é descartado (o e-mail ainda pode salvar)');
  ok(normalizarEvento({ playerIdentifier: 'Fasi' }) === null, 'sem eventId não é evento');
  ok(normalizarEvento({ eventId: 'e4' }) === null, 'e sem nenhum identificador também não');
  ok(normalizarEvento(null) === null && normalizarEvento('x') === null, 'lixo devolve null');

  // A recarga é contada a partir do `votadoEm`, então uma data adiantada trancaria o jogador
  // por mais tempo do que a regra manda — e ele não teria como perceber.
  const futuro = normalizarEvento({
    eventId: 'ef', playerIdentifier: 'Fasi', votedAt: new Date(Date.now() + 864e5).toISOString(),
  });
  ok(futuro.votadoEm.getTime() <= Date.now() + 1000, 'votedAt no futuro é preso no agora');
}

secao('O payload REAL do TopIdle (copiado da produção, 13/08/2026)');
{
  // Resposta literal de GET /api/v1/votes?after=0. Está aqui porque foi ela que derrubou duas
  // suposições minhas: não vem identidade de votante nenhuma, e existe um campo `type`.
  const real = {
    eventId: 'vote_9ALd-9fZKSkWzIUu2gmFw48O',
    gameId: 'pokeidle-io-5f9969',
    playerIdentifier: 'TioLucifer',
    type: 'vote.created',
    votedAt: '2026-08-13T17:00:13Z',
  };
  const ev = normalizarEvento(real);
  ok(ev?.eventId === real.eventId, 'o evento de produção é lido');
  ok(ev.identificador === 'TioLucifer', 'e o nick vem no playerIdentifier');
  ok(ev.votadoEm.toISOString() === '2026-08-13T17:00:13.000Z', 'com a data certa');
  // O achado que definiu o teto diário em 1: sem isto, o vínculo de conta não roda.
  ok(ev.votante === '',
     'e NÃO traz identidade da conta que votou — o vínculo fica cego', JSON.stringify(ev.votante));

  ok(normalizarEvento({ ...real, type: 'vote.deleted' }) === null,
     'um tipo diferente de vote.created é descartado');
  ok(normalizarEvento({ ...real, type: undefined })?.eventId === real.eventId,
     'e evento sem `type` passa (o "Enviar teste" pode não carimbar)');

  // O envelope da API: { events: [...], nextCursor: N }.
  const envelope = { events: [real], nextCursor: 418 };
  ok(envelope.events.map(normalizarEvento).filter(Boolean).length === 1,
     'o envelope de lista da API rende um evento');
}

secao('Identidade do votante (a chave do vínculo de conta)');
{
  ok(chaveVotante({ voterId: 'V-1', email: 'a@b.com' }) === 'v-1',
     'o id do votante ganha do e-mail — e-mail muda, id não');
  ok(chaveVotante({ googleSub: 'ABC' }) === 'abc', 'o sub do Google serve');
  ok(chaveVotante({ email: 'A@B.com' }) === 'a@b.com', 'e o e-mail é o último recurso');
  ok(chaveVotante({ playerIdentifier: 'Fasi' }) === '',
     'o NICK não serve de votante — é justamente ele que o fraudador repete');
  ok(chaveVotante({}) === '' && chaveVotante(null) === '', 'sem nada devolve vazio');

  const ev = normalizarEvento({ eventId: 'e5', playerIdentifier: 'Fasi', voterId: 'V-9' });
  ok(ev.votante === 'v-9', 'e o evento normalizado carrega o votante');
}

// ------------------------------------------------------------- assinatura

secao('Assinatura do webhook');
{
  // O módulo de rotas lê o segredo do ambiente no `import` — então ele é posto ANTES.
  process.env.TOPIDLE_WEBHOOK_SECRET = 'segredo-de-teste';
  const { verificarAssinatura } = await import('../src/server/topidle-rotas.mjs');

  const corpo = JSON.stringify({ eventId: 'e9', playerIdentifier: 'Fasi' });
  const carimbo = String(Math.floor(Date.now() / 1000));
  const assinar = (ts, body, segredo = 'segredo-de-teste') =>
    createHmac('sha256', segredo).update(`${ts}.${body}`).digest('hex');

  const cab = (ts, sig) => ({ 'x-topidle-timestamp': ts, 'x-topidle-signature': sig });

  const bom = verificarAssinatura(corpo, cab(carimbo, assinar(carimbo, corpo)));
  ok(bom.eventId === 'e9', 'assinatura correta passa e devolve o corpo parseado');

  ok(verificarAssinatura(corpo, cab(carimbo, `sha256=${assinar(carimbo, corpo)}`)).eventId === 'e9',
     'e o prefixo `sha256=` é tolerado');

  const recusa = (cabecalhos, corpoEnviado = corpo) => {
    try {
      verificarAssinatura(corpoEnviado, cabecalhos);
      return false;
    } catch {
      return true;
    }
  };

  ok(recusa(cab(carimbo, assinar(carimbo, corpo)), `${corpo} `),
     'corpo alterado depois de assinado é recusado');
  ok(recusa(cab(carimbo, assinar(carimbo, corpo, 'outro-segredo'))),
     'segredo errado é recusado');
  const velho = String(Math.floor(Date.now() / 1000) - 3600);
  ok(recusa(cab(velho, assinar(velho, corpo))),
     'assinatura válida mas VELHA é recusada (replay)');
  ok(recusa(cab(carimbo, '')), 'sem assinatura é recusado');
  ok(recusa({ 'x-topidle-signature': assinar(carimbo, corpo) }), 'sem carimbo é recusado');
  ok(recusa(cab('ontem', assinar('ontem', corpo))), 'carimbo que não é número é recusado');

  // Milissegundos também: se eles trocarem a unidade, isto continua fechando.
  const ms = String(Date.now());
  ok(verificarAssinatura(corpo, cab(ms, assinar(ms, corpo))).eventId === 'e9',
     'carimbo em milissegundos também vale');
}

// ------------------------------------------------------------------- banco
//
// A parte que só o Postgres prova: idempotência do `event_id` e o teto diário. As duas são
// travas de DINHEIRO — furar qualquer uma transforma o Vote & Ganhe numa impressora.

secao('Banco (Postgres)');
const { pool } = await import('../src/server/db.mjs');
let temBanco = true;
try {
  await pool.query('SELECT 1');
} catch (err) {
  temBanco = false;
  console.log(`  · Postgres indisponível (${err.message}) — pulando a parte transacional`);
  console.log('    suba com: npm run infra');
}

if (temBanco) {
  const { migrar } = await import('../src/server/db.mjs');
  const ddb = await import('../src/server/diamantes-db.mjs');
  const tdb = await import('../src/server/topidle-db.mjs');
  await migrar();
  await ddb.migrar();
  await tdb.migrar();

  const nick = `vt${Math.floor(Math.random() * 1e6)}`;
  const outroNick = `vo${Math.floor(Math.random() * 1e6)}`;
  const { rows } = await pool.query(
    `INSERT INTO players (nick) VALUES ($1), ($2) RETURNING id`, [nick, outroNick],
  );
  const id = Number(rows[0].id);
  const outroId = Number(rows[1].id);
  const limpar = async () => {
    await pool.query(`DELETE FROM topidle_votos WHERE player_id = ANY($1::bigint[])`, [[id, outroId]]);
    await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [[id, outroId]]);
  };

  const hoje = new Date();
  const ontem = new Date(Date.now() - 36 * 60 * 60 * 1000);
  // `votante` é a conta do TopIdle. Por padrão cada teste usa a MESMA, que é o caso honesto.
  const voto = (eventId, { quando = hoje, identificador = nick, votante = 'conta-1' } = {}) =>
    tdb.registrarVoto({ eventId, identificador, email: '', votante, votadoEm: quando });

  // Solta a RECARGA sem apagar as provas: só as linhas que CONTARAM saem, porque é nelas que
  // mora o `proximo_em`. As recusadas (`muitos_votantes`, `recarga`) ficam — é delas que a
  // consulta de auditoria vive, e apagá-las faria o teste de suspeitos passar por engano.
  const zerarRecarga = () => pool.query(
    `DELETE FROM topidle_votos WHERE player_id = ANY($1::bigint[]) AND conta`, [[id, outroId]],
  );

  try {
    secao('Um diamante a cada dois votos — e o par leva DOIS dias');
    ok((await ddb.saldoDe(id)) === 0, 'o jogador começa sem diamante nenhum');

    // Com teto de 1/dia e recarga de 24 h no TopIdle, o par só fecha no dia seguinte. É a
    // taxa combinada: um diamante a cada dois dias.
    const v1 = await voto(`${nick}-1`, { quando: ontem });
    ok(v1.novo && v1.contou && !v1.creditado, 'o primeiro voto CONTA mas não paga', JSON.stringify(v1));
    ok((await ddb.saldoDe(id)) === 0, 'e o saldo continua zero');

    const v2 = await voto(`${nick}-2`);
    ok(v2.contou && v2.creditado && v2.qtd === DIAMANTES_POR_PAR,
       'o voto do dia seguinte fecha o par e paga', JSON.stringify(v2));
    ok((await ddb.saldoDe(id)) === DIAMANTES_POR_PAR, 'e o saldo subiu um diamante');

    secao('Idempotência (o TopIdle reenvia até receber 200)');
    const repetido = await voto(`${nick}-2`);
    ok(!repetido.novo && !repetido.creditado, 'o mesmo eventId não credita de novo');
    ok((await ddb.saldoDe(id)) === DIAMANTES_POR_PAR, 'e o saldo não se mexeu');

    // Webhook e recuperação pela API chegando ao mesmo tempo, de verdade. Um voto ontem
    // (conta) e três chegadas do MESMO evento hoje: só uma pode fechar o par.
    await zerarRecarga();
    await voto(`${nick}-a`, { quando: ontem });
    const juntos = await Promise.all([voto(`${nick}-b`), voto(`${nick}-b`), voto(`${nick}-b`)]);
    ok(juntos.filter((r) => r.creditado).length === 1,
       'três chegadas SIMULTÂNEAS do mesmo evento creditam uma só vez',
       JSON.stringify(juntos.map((r) => r.creditado)));

    // ------------------------------------------------ a RECARGA por jogador
    //
    // O cenário REPRODUZIDO em produção: o TopIdle não barra multi-conta, então dá para logar
    // com um e-mail, votar em "fasi", trocar de e-mail e votar em "fasi" de novo, segundos
    // depois. Os dois eventos chegam legítimos e assinados, e o servidor não tem como
    // distingui-los pelo conteúdo — o evento não traz identidade da conta que votou.
    secao('Recarga por jogador — a defesa contra as duas contas');
    const saldoAntes = await ddb.saldoDe(id);
    const v3 = await voto(`${nick}-3`);
    ok(v3.novo && !v3.contou && v3.motivoZero === 'recarga',
       'a SEGUNDA conta vota logo depois e o voto entra sem contar', JSON.stringify(v3));
    ok((await ddb.saldoDe(id)) === saldoAntes, 'e o saldo não subiu');

    // O furo de calendário que a janela deslizante fecha: 23h50 e 00h10 são dias UTC
    // diferentes, e com um teto "por dia" os dois passariam, vinte minutos depois um do outro.
    await zerarRecarga();
    const virada = new Date('2026-08-13T23:50:00Z');
    const depois = new Date('2026-08-14T00:10:00Z');
    const antesDaMeiaNoite = await voto(`${nick}-v1`, { quando: virada });
    ok(antesDaMeiaNoite.contou, 'um voto às 23h50 conta');
    const depoisDaMeiaNoite = await voto(`${nick}-v2`, { quando: depois });
    ok(!depoisDaMeiaNoite.contou && depoisDaMeiaNoite.motivoZero === 'recarga',
       'e o das 00h10 do dia seguinte NÃO conta — a janela não tem beira de calendário',
       JSON.stringify(depoisDaMeiaNoite));

    // A rajada do relato: cinco contas do TopIdle no mesmo nick, ao mesmo tempo.
    await zerarRecarga();
    const base = await ddb.saldoDe(id);
    const rajada = await Promise.all([1, 2, 3, 4, 5].map((n) => voto(`${nick}-r${n}`)));
    ok(rajada.filter((r) => r.contou).length === 1,
       'cinco votos simultâneos contam UM só — a fazenda de contas não acelera nada',
       JSON.stringify(rajada.map((r) => r.contou)));
    ok((await ddb.saldoDe(id)) === base,
       'e nenhum diamante sai de uma rajada', `${await ddb.saldoDe(id)} vs ${base}`);

    // E o voto honesto, 24 h depois, continua contando.
    await zerarRecarga();
    await voto(`${nick}-h1`, { quando: ontem });
    const honesto = await voto(`${nick}-h2`);
    ok(honesto.contou, 'o voto do dia seguinte conta normalmente');

    // Um evento ANTIGO que chega atrasado (recuperação da API depois de o webhook cair) é
    // julgado pela data dele, não pela de chegada — e um voto anterior ao último que contou
    // não reabre a janela. Recusar aqui é o lado seguro: no máximo o jogador espera o próximo.
    const atrasado = await voto(`${nick}-atrasado`, { quando: ontem });
    ok(!atrasado.contou && atrasado.motivoZero === 'recarga',
       'evento antigo chegando atrasado não fura a recarga', JSON.stringify(atrasado));

    // --------------------------------------------------- multi-conta no TopIdle
    //
    // O cenário do relato: a pessoa abre várias contas lá e vota em todas com o mesmo nick.
    secao('Fazenda de contas do TopIdle');
    await zerarRecarga();
    await pool.query(`DELETE FROM topidle_votantes WHERE player_id = ANY($1::bigint[])`, [[id, outroId]]);

    // O teto diário é zerado entre um voto e outro para ISOLAR a trava de votante — senão
    // seria o teto barrando tudo, e o teste passaria sem provar nada sobre o vínculo.
    const c1 = await voto(`${nick}-mc1`, { votante: 'farm-1' });
    ok(c1.contou, 'a primeira conta vota normalmente');
    await zerarRecarga();
    const c2 = await voto(`${nick}-mc2`, { votante: 'farm-2' });
    ok(c2.contou, 'a segunda também (trocar de e-mail acontece)');

    await zerarRecarga();
    const c3 = await voto(`${nick}-mc3`, { votante: 'farm-3' });
    ok(c3.novo && !c3.contou && c3.motivoZero === 'muitos_votantes',
       'a TERCEIRA conta é barrada — é o padrão de fazenda', JSON.stringify(c3));
    const c4 = await voto(`${nick}-mc4`, { votante: 'farm-4' });
    ok(!c4.contou && c4.motivoZero === 'muitos_votantes', 'e a quarta também');

    await zerarRecarga();
    ok((await voto(`${nick}-mc5`, { votante: 'farm-1' })).contou,
       'mas as duas contas JÁ VINCULADAS continuam valendo');

    secao('Uma conta do TopIdle serve a um jogador só');
    const roubo = await tdb.registrarVoto({
      eventId: `${nick}-roubo`, identificador: outroNick, email: '',
      votante: 'farm-1', votadoEm: hoje,
    });
    ok(roubo.novo && !roubo.contou && roubo.motivoZero === 'votante_de_outro',
       'a conta presa ao primeiro jogador não conta para um segundo', JSON.stringify(roubo));
    ok((await ddb.saldoDe(outroId)) === 0, 'e o segundo jogador não ganhou nada');

    // Antes de qualquer limpeza: são as linhas recusadas acima que alimentam esta consulta.
    secao('Auditoria');
    const suspeitos = await tdb.suspeitosDeMultiConta(20);
    ok(suspeitos.some((s) => s.nick === nick),
       'quem juntou contas barradas aparece na lista', JSON.stringify(suspeitos));
    ok(suspeitos.some((s) => s.nick === outroNick),
       'e quem recebeu voto de conta alheia também');

    secao('Evento sem identidade de votante');
    await zerarRecarga();
    const cego = await voto(`${nick}-cego`, { votante: '' });
    ok(cego.contou && cego.motivoZero === 'sem_votante',
       'conta (senão ninguém receberia), mas fica MARCADO', JSON.stringify(cego));

    secao('Voto sem dono');
    const orfao = await tdb.registrarVoto({
      eventId: `${nick}-orfao`, identificador: 'ninguem_aqui_0', email: '',
      votante: 'x', votadoEm: hoje,
    });
    ok(orfao.novo && !orfao.contou && orfao.motivoZero === 'sem_dono',
       'fica gravado, sem dono e sem crédito', JSON.stringify(orfao));
    ok(!(await tdb.registrarVoto({
      eventId: `${nick}-orfao`, identificador: nick, email: '', votante: 'x', votadoEm: hoje,
    })).contou, 'e reenviar o MESMO evento com outro nick não vira crédito');

    // Fecha um par para a caixa postal ter o que entregar. Dois DIAS diferentes (o teto é de
    // um por dia) e com contas JÁ VINCULADAS — `conta-1` seria a terceira e cairia na trava.
    await zerarRecarga();
    await voto(`${nick}-cx1`, { quando: ontem, votante: 'farm-1' });
    await voto(`${nick}-cx2`, { votante: 'farm-2' });

    secao('Caixa postal');
    const pendentes = await tdb.jogadoresComVotoPendente([id]);
    ok(pendentes.has(id), 'o jogador aparece com voto a entregar');
    const recolhido = await tdb.recolherVotos(id);
    ok(recolhido.votos > 0 && recolhido.diamonds === (await ddb.saldoDe(id)),
       'recolher devolve o saldo do banco — NÃO soma de novo', JSON.stringify(recolhido));
    ok((await tdb.recolherVotos(id)).votos === 0, 'e recolher de novo não traz nada');
    ok(!(await tdb.jogadoresComVotoPendente([id])).has(id), 'a caixa fica vazia');

    secao('Painel');
    const painel = await tdb.painelDe(id);
    ok(painel.recargaMs === RECARGA_MS
      && painel.porPar === DIAMANTES_POR_PAR
      && painel.votosPorDiamante === VOTOS_POR_DIAMANTE,
       'o painel anuncia a regra em vigor', JSON.stringify(painel));
    ok(painel.votos > 0 && painel.diamantes > 0, 'e soma o histórico do jogador');
    ok(painel.noPar >= 0 && painel.noPar < VOTOS_POR_DIAMANTE,
       'o progresso do par fica dentro do par', String(painel.noPar));
    ok(painel.esperaMs >= 0, 'a espera nunca é negativa');

    secao('Ledger');
    const extrato = await ddb.extratoDoJogador(id, 50);
    const doVoto = extrato.filter((l) => l.motivo === MOTIVO.VOTO);
    ok(doVoto.length > 0, 'cada crédito de voto deixou linha no ledger de diamantes');
    ok(doVoto.every((l) => l.delta === DIAMANTES_POR_PAR && l.ref),
       'com o valor certo e a referência do evento');
    ok((await ddb.conferirSaldo(50)).every((r) => Number(r.id) !== id),
       'e o cache do jogador bate com o ledger');
  } finally {
    await limpar();
    await pool.end();
  }
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
