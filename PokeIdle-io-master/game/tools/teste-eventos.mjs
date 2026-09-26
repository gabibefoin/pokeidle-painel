// O EVENTO global faz o que promete?
//
// O buff que o painel admin liga vale para o servidor inteiro e mexe em três números que o
// jogador vê render: XP do treinador, XP do pokémon e farm. Um erro aqui não trava nada — só
// entrega (ou deixa de entregar) progresso a todo mundo ao mesmo tempo, calado. Por isso o
// teste cobre as duas pontas: a matemática do multiplicador e a linha no banco.
//
// A AGENDA semanal entra no mesmo arquivo pelo mesmo motivo: ela não é outro buff, é quem
// aperta o mesmo botão sozinho na sexta ao meio-dia. O que ela tem de próprio é relógio —
// fuso, janela de atraso e disparo uma vez só —, e é isso que a última seção cobre.
//
// Não precisa do servidor de pé, mas precisa do Postgres (`npm run infra`).
//
//   npm run test:eventos
import { pool } from '../src/server/db.mjs';
import * as edb from '../src/server/eventos-db.mjs';
import {
  definirEvento,
  eventoAtivo,
  eventoParaCliente,
  multEventoXpTreinador,
  multEventoXpPokemon,
  bonusEventoFarmPct,
  limitarPct,
  limitarMinutos,
  EVENTO_PCT_MAX,
  EVENTO_MINUTOS_MAX,
} from '../src/server/game/eventos.mjs';
import { multXpTreinador, multXpPokemon, bonusLootPct } from '../src/server/game/loja.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);
const perto = (a, b) => Math.abs(a - b) < 1e-9;

console.log('Eventos globais\n===============');

// ------------------------------------------------------------------ limites

secao('Os limites');
{
  ok(limitarPct(-40) === 0, 'porcentagem negativa vira 0');
  ok(limitarPct(50.4) === 50, 'porcentagem é inteira');
  ok(limitarPct(999999) === EVENTO_PCT_MAX, `teto de ${EVENTO_PCT_MAX}%`);
  ok(limitarPct('abc') === 0, 'texto não vira NaN');
  ok(limitarMinutos(0) === 1, 'duração mínima de 1 minuto');
  ok(limitarMinutos(9e9) === EVENTO_MINUTOS_MAX, `teto de ${EVENTO_MINUTOS_MAX} minutos (7 dias)`);
}

// ------------------------------------------------------- o multiplicador

secao('O multiplicador');
{
  definirEvento(null);
  ok(eventoAtivo() === null, 'sem evento, nada ativo');
  ok(multEventoXpTreinador() === 1, 'sem evento, XP do treinador ×1');
  ok(multEventoXpPokemon() === 1, 'sem evento, XP do pokémon ×1');
  ok(bonusEventoFarmPct() === 0, 'sem evento, farm +0%');
  ok(eventoParaCliente() === null, 'e a tela não recebe faixa nenhuma');

  definirEvento({
    id: 1, xpTreinadorPct: 50, xpPokemonPct: 75, farmPct: 30, minutos: 60,
    terminaEm: Date.now() + 60 * 60 * 1000,
  });
  ok(perto(multEventoXpTreinador(), 1.5), 'evento de +50% → ×1,5 no treinador');
  ok(perto(multEventoXpPokemon(), 1.75), 'evento de +75% → ×1,75 no pokémon');
  ok(bonusEventoFarmPct() === 30, 'evento de +30% de farm → +30 pontos de loot');
  ok(eventoParaCliente()?.terminaEm > Date.now(), 'a tela recebe o carimbo do fim');
}

// ------------------------------------------------------------- expiração

secao('A expiração');
{
  // O prazo é um CARIMBO: ninguém precisa avisar o servidor que acabou. Isto é o que garante
  // que um processo que subiu depois do fim do evento não continue pagando o bônus.
  definirEvento({
    id: 2, xpTreinadorPct: 100, xpPokemonPct: 100, farmPct: 100, minutos: 5,
    terminaEm: Date.now() - 1000,
  });
  ok(eventoAtivo() === null, 'evento vencido não fica ativo');
  ok(multEventoXpTreinador() === 1, 'e o multiplicador volta a 1 sozinho');
  ok(bonusEventoFarmPct() === 0, 'e o farm volta a 0 sozinho');
}

// ----------------------------------------------- somado ao que o jogador tem

secao('Somado ao que o jogador já tem');
{
  // O evento NÃO substitui o que foi comprado: ele multiplica em cima. Quem pagou o boost
  // continua rendendo mais que o vizinho durante o evento — é o mínimo que se deve a quem pagou.
  const agora = Date.now();
  const semNada = { boosts: {}, vipAte: 0, guildBonusPct: 0 };
  const comBoost = { boosts: { xp: agora + 60_000 }, vipAte: 0, guildBonusPct: 0 };

  definirEvento(null);
  const baseSem = multXpTreinador(semNada, agora);
  const baseCom = multXpTreinador(comBoost, agora);
  ok(perto(baseSem, 1), 'sem evento e sem boost: ×1');
  ok(baseCom > baseSem, 'o boost da loja sozinho já rende mais');

  definirEvento({
    id: 3, xpTreinadorPct: 100, xpPokemonPct: 100, farmPct: 25, minutos: 30,
    terminaEm: agora + 30 * 60 * 1000,
  });
  ok(perto(multXpTreinador(semNada, agora), baseSem * 2), 'evento de +100% dobra quem não tem nada');
  ok(perto(multXpTreinador(comBoost, agora), baseCom * 2), 'e dobra TAMBÉM quem comprou boost');
  ok(perto(multXpPokemon(semNada, agora), 2), 'o mesmo vale para o XP do pokémon');
  ok(
    bonusLootPct({ ...semNada, guildBonusPct: 10 }, agora) === 35,
    'farm do evento SOMA ao bônus de guild (10 + 25 = 35)',
    `veio ${bonusLootPct({ ...semNada, guildBonusPct: 10 }, agora)}`,
  );
  definirEvento(null);
}

// ------------------------------------------------------------------ banco

secao('O banco');
{
  await edb.migrar();
  // Começa do zero: um evento de outro teste (ou do dev brincando no painel) ainda em pé
  // faria a checagem de "só um por vez" passar por sorte.
  await edb.encerrarEvento('teste');

  const ev = await edb.criarEvento({
    xpTreinadorPct: 40, xpPokemonPct: 60, farmPct: 20, minutos: 90, criadoPor: 'teste@local',
  });
  ok(ev.id > 0, 'criou o evento');
  ok(ev.terminaEm - ev.criadoEm > 89 * 60_000, 'o fim é 90 minutos depois do início');

  const vigente = await edb.eventoVigente();
  ok(vigente?.id === ev.id, 'e ele é o vigente');

  const segundo = await edb.criarEvento({
    xpTreinadorPct: 10, xpPokemonPct: 0, farmPct: 0, minutos: 10, criadoPor: 'teste@local',
  });
  const agoraVigente = await edb.eventoVigente();
  ok(agoraVigente?.id === segundo.id, 'ligar outro substitui o anterior');
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM eventos_buff WHERE termina_em > now()`);
  ok(rows[0].n === 1, 'nunca há dois eventos valendo ao mesmo tempo', `achei ${rows[0].n}`);

  let erro = null;
  await edb.criarEvento({ xpTreinadorPct: 0, xpPokemonPct: 0, farmPct: 0, minutos: 10 })
    .catch((e) => (erro = e.message));
  ok(!!erro, 'evento sem bônus nenhum é recusado', erro ?? 'passou');

  const encerrado = await edb.encerrarEvento('teste@local');
  ok(encerrado?.id === segundo.id, 'encerrar corta o que estava em pé');
  ok((await edb.eventoVigente()) === null, 'e depois não sobra vigente');

  const hist = await edb.listarEventos(10);
  ok(hist.length >= 2, 'o histórico guarda os encerrados', `veio ${hist.length}`);
  ok(hist[0].id > hist[1].id, 'do mais novo para o mais velho');
}

// ----------------------------------------------------------------- agenda

// A regra que se repete: "toda sexta, meio-dia". O que importa aqui é o RELÓGIO — a hora
// marcada é de parede no Brasil, o disparo tem de acontecer uma vez só, e uma regra criada
// depois da hora não pode ligar o evento que já passou.

secao('A agenda semanal');
{
  await edb.encerrarEvento('teste');
  // "Agora" em São Paulo, que é o fuso em que o admin escreve a regra.
  const sp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const minutoDoDia = sp.getHours() * 60 + sp.getMinutes();
  const em = (delta) => {
    const t = (minutoDoDia + delta + 1440) % 1440;
    return { hora: Math.floor(t / 60), minuto: t % 60 };
  };
  const buffs = { xpTreinadorPct: 15, xpPokemonPct: 15, farmPct: 5, minutos: 720 };
  const nova = async (dia, quando) =>
    edb.criarAgenda({ dias: [dia], ...quando, ...buffs, criadoPor: 'teste@local' });

  const criadas = [];
  try {
    const vencida = await nova(sp.getDay(), em(-5));
    const futura = await nova(sp.getDay(), em(+90));
    const atrasada = await nova(sp.getDay(), em(-45));
    const outroDia = await nova((sp.getDay() + 3) % 7, em(-5));
    criadas.push(vencida.id, futura.id, atrasada.id, outroDia.id);

    ok(vencida.ultimoEm != null, 'regra criada depois da hora já nasce com a ocorrência gasta');
    ok(futura.ultimoEm === null, 'e a criada antes da hora nasce devendo o disparo de hoje');

    let erro = null;
    await edb.criarAgenda({ dias: [], hora: 1, minuto: 0, ...buffs }).catch((e) => (erro = e.message));
    ok(!!erro, 'regra sem dia da semana é recusada', erro ?? 'passou');
    erro = null;
    await edb.criarAgenda({ dias: [1], hora: 1, minuto: 0, minutos: 10 }).catch((e) => (erro = e.message));
    ok(!!erro, 'regra sem bônus nenhum é recusada', erro ?? 'passou');

    // A `vencida` nasceu quitada; zerar a marca simula a regra que existe desde a semana
    // passada — o estado real de toda regra que dispara.
    await pool.query('UPDATE eventos_agenda SET ultimo_em = NULL WHERE id = $1', [vencida.id]);

    const ligadas = await edb.reivindicarAgendasVencidas();
    const ids = ligadas.map((r) => r.id);
    ok(ids.includes(vencida.id), 'a ocorrência vencida dentro da janela dispara', `ligou ${ids}`);
    ok(!ids.includes(futura.id), 'a hora que ainda não chegou não dispara');
    ok(!ids.includes(atrasada.id), 'atraso maior que a tolerância pula a semana');
    ok(!ids.includes(outroDia.id), 'outro dia da semana não dispara hoje');
    ok((await edb.reivindicarAgendasVencidas()).length === 0,
      'o tique seguinte não dispara a mesma ocorrência de novo');

    const lista = await edb.listarAgendas();
    const daqui = (ms) => Math.round((ms - Date.now()) / 60_000);
    const pf = lista.find((a) => a.id === futura.id);
    const pv = lista.find((a) => a.id === vencida.id);
    ok(Math.abs(daqui(pf.proximoEm) - 90) <= 1, 'o próximo disparo de hoje sai em ~90 min',
      `veio ${daqui(pf.proximoEm)}`);
    ok(Math.abs(daqui(pv.proximoEm) - (7 * 1440 - 5)) <= 1,
      'a que já passou hoje aponta para a semana que vem', `veio ${daqui(pv.proximoEm)}`);

    const { rows: parede } = await pool.query(
      `SELECT to_char($1::timestamptz AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS h`,
      [new Date(pf.proximoEm)],
    );
    const marcada = `${String(pf.hora).padStart(2, '0')}:${String(pf.minuto).padStart(2, '0')}`;
    ok(parede[0].h === marcada, 'a hora marcada é hora de parede do Brasil, não do servidor',
      `banco diz ${parede[0].h}, regra diz ${marcada}`);

    const pausada = await edb.alternarAgenda(futura.id, false);
    ok(pausada?.ativa === false, 'pausar desliga a regra sem apagá-la');
    await edb.alternarAgenda(futura.id, true);
  } finally {
    for (const id of criadas) await edb.removerAgenda(id);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM eventos_agenda WHERE criado_por = 'teste@local'`,
    );
    ok(rows[0].n === 0, 'o teste não deixa regra para trás', `sobraram ${rows[0].n}`);
  }
}

console.log(`\n==============================================`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `tudo certo (${testes} testes)`);
await pool.end();
process.exit(falhas ? 1 : 0);
