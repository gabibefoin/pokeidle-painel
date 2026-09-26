// MEGA EVOLUÇÃO de ponta a ponta — conta de verdade, socket de verdade, banco de verdade.
//
// Os testes de unidade (`teste-megas.mjs`) e de ataque (`teste-seguranca-megas.mjs`) rodam sem
// servidor e medem as funções. Este mede o CAMINHO: o fragmento chega na bolsa, a bancada cobra
// dez e entrega a pedra, `pokemon.mega` troca a espécie, o estado que volta traz o #3xxx com a
// arte e o poder novos, e a troca sobrevive ao relogin. É o que nenhum teste de função pega —
// um handler que não está registrado, um campo que não viaja no delta, uma gravação que some.
//
// Precisa do servidor no ar, em DEV:
//
//     MAX_CONTAS_POR_IP=0 RESEND_API_KEY= npm start
//     node tools/teste-mega-e2e.mjs
import WebSocket from 'ws';
import '../src/server/config.mjs';
import { pool, inserirPokemon } from '../src/server/db.mjs';
import { conectarBus, enviarParaSim } from '../src/server/bus.mjs';
import { sessaoPara, helloCom } from './auth-teste.mjs';
import {
  especies,
  calcularStats,
  hpDeCombate,
  xpTotalParaNivel,
  multDeNascenca,
} from '../src/server/content.mjs';
import { poderDePokemon } from '../src/shared/nota-pokemon.mjs';
import { MEGAS, megaPokeId, looktypeMega } from '../src/shared/megas.mjs';
import {
  FRAGMENTO_MEGA_ID,
  FRAGMENTO_MEGA_SHINY_ID,
  MEGA_STONE_POR_DEX,
  MEGA_SHINY_STONE_POR_DEX,
} from '../src/server/game/itens-nossos.mjs';

const WS_URL = process.env.WS_URL ?? 'ws://localhost:8080';
const NICK = process.env.NICK ?? 'megae2e';
const CHAVE = NICK.toLowerCase();

let testes = 0;
let falhas = 0;
function ok(cond, nome, detalhe = '') {
  testes++;
  if (cond) return console.log(`  ok  ${nome}`);
  falhas++;
  console.log(`  FALHOU  ${nome}${detalhe ? ` - ${detalhe}` : ''}`);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Um cliente burro: guarda o último snapshot, os eventos e os avisos que chegaram. */
function abrir(sessao) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const cli = { ws, eu: null, avisos: [], eventos: [], itens: new Map() };
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify(helloCom(sessao))));
    ws.on('message', (buf) => {
      let m;
      try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.t === 'welcome') {
        cli.welcome = m;
        for (const i of m.itensNossos ?? []) cli.itens.set(i.id, i);
        resolve(cli);
      }
      // O `hello` daqui NAO pede delta, entao todo `estado` que chega e o snapshot INTEIRO
      // (`cheio: true`) - ver `estadoParaEnviar` no sim. E o que deixa este cliente de teste
      // ser trinta linhas em vez de reimplementar o mesclador do app.js.
      if (m.estado) cli.eu = m.estado;
      // Os eventos viajam em lote, num pacote proprio (`{ t: 'batalha', ev: [...] }`) e nao
      // dentro do estado - e o mesmo canal do dano, do level up e da captura.
      for (const e of m.ev ?? []) {
        cli.eventos.push(e);
        if (e.k === 'aviso') cli.avisos.push(e.msg);
      }
    });
    setTimeout(() => reject(new Error('welcome nao chegou em 20 s')), 20_000);
  });
}

const enviar = (cli, msg) => cli.ws.send(JSON.stringify(msg));
const item = (cli, id) => Number(cli.eu?.items?.[id] ?? 0);
const meuPk = (cli, id) => (cli.eu?.pokemons ?? []).find((k) => k.id === id);

/** Espera até `cond()` virar verdade. Os deltas chegam a cada tick de 250 ms. */
async function ate(cond, ms = 8000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (cond()) return true;
    await dormir(120);
  }
  return false;
}

console.log(`\nMEGA E2E - ${WS_URL} - conta ${NICK}\n`);

// ------------------------------------------------------------------ o cenário
//
// Montado NO BANCO, com a conta descarregada.
//
// Não dá para montar pelo socket: os `admin.*` chegam pelo BARRAMENTO, e o gateway carimba
// `doCliente: true` no que veio do cliente justamente para que nenhum deles seja alcançável
// dali. E não dá para editar com a conta viva num sim: fechar o socket não descarrega nada —
// o jogador fica 90 s em carência (`GRACA_DESCONEXAO_MS`), e o flush seguinte grava a memória
// por cima do UPDATE. `admin.ban` no barramento é o único caminho que tira da memória SEM
// gravar, que é exatamente o que um roteiro de teste precisa para semear por baixo.

const sessao = await sessaoPara(NICK);
const primeiro = await abrir(sessao);
primeiro.ws.close();
await dormir(1500);

await conectarBus();
enviarParaSim(CHAVE, { t: 'admin.ban', playerId: CHAVE });
await dormir(2000);

const { rows } = await pool.query('SELECT id FROM players WHERE lower(nick) = lower($1)', [NICK]);
if (!rows[0]) {
  console.error(`a conta ${NICK} nao tem linha em players - o primeiro login nao completou`);
  process.exit(1);
}
const playerId = Number(rows[0].id);

// Conta limpa a cada rodada: sem isto o Gengar da rodada anterior (já mega) entraria junto e o
// teste mediria o bicho errado.
await pool.query('DELETE FROM player_pokemon WHERE player_id = $1', [playerId]);
await pool.query('UPDATE players SET items = $2::jsonb WHERE id = $1', [
  playerId,
  JSON.stringify({ [FRAGMENTO_MEGA_ID]: 30, [FRAGMENTO_MEGA_SHINY_ID]: 20 }),
]);

const espGengar = especies.get(94);
const ivs = { hp: 18, atk: 20, def: 15, spAtk: 14, spDef: 16, speed: 22 };
const nivel = 60;
const qualidade = 1.164;
const statsGengar = calcularStats(espGengar, ivs, nivel, qualidade, multDeNascenca(1, false));
const pkId = Number((await inserirPokemon(playerId, {
  speciesId: 94,
  level: nivel,
  xp: xpTotalParaNivel(nivel),
  quality: qualidade,
  ivs: JSON.stringify(ivs),
  hp: hpDeCombate(statsGengar.hp),
  shiny: false,
  slot: null,
  potencia: 1,
  power: poderDePokemon({ ivs, quality: qualidade, potencia: 1, shiny: false, level: nivel }),
  starter: false,
})).id);
console.log(`  cenario: player ${playerId} - Gengar nv ${nivel} (pk ${pkId}) - 30 + 20 fragmentos\n`);

const cli = await abrir(sessao);
ok(!!cli.welcome, 'welcome recebido');

// ---------------------------------------------------------------- o welcome

console.log('\n- o que o welcome traz');
const cfg = cli.welcome.mega;
ok(!!cfg, 'o welcome traz a config da mega');
ok(cfg?.pedras?.length === MEGAS.length, `com as ${MEGAS.length} megas (${cfg?.pedras?.length})`);
ok(cfg?.fragmentoId === FRAGMENTO_MEGA_ID, 'e o id do fragmento comum');
ok(cfg?.fragmentoShinyId === FRAGMENTO_MEGA_SHINY_ID, 'e o do shiny');
ok(cli.itens.has(MEGA_STONE_POR_DEX[94]), 'a Gengarite viaja no catalogo de itens nossos');
ok(cli.itens.has(MEGA_SHINY_STONE_POR_DEX[94]), 'a Shiny Gengarite tambem');
ok(
  cli.itens.get(MEGA_STONE_POR_DEX[94])?.icon === '/img/itens/mega/gengarite.png',
  'com o icone certo',
);
ok((cli.welcome.shinyLooks ?? {})[megaPokeId(94)] === 85094, 'e o looktype da mega shiny esta em shinyLooks');

// ------------------------------------------------------ a bancada, pelo socket

console.log('\n- a bancada do Professor, pelo socket');

const creditou = await ate(() => item(cli, FRAGMENTO_MEGA_ID) >= 30);
ok(creditou, `os 30 Fragmentos de Mega Stone chegaram na bolsa (${item(cli, FRAGMENTO_MEGA_ID)})`);

const fragAntes = item(cli, FRAGMENTO_MEGA_ID);
const pedraAntes = item(cli, MEGA_STONE_POR_DEX[94]);
enviar(cli, { t: 'mega.fabricar', dex: 94 });
ok(await ate(() => item(cli, MEGA_STONE_POR_DEX[94]) > pedraAntes), 'fabricar a Gengarite funciona pelo socket');
ok(
  item(cli, FRAGMENTO_MEGA_ID) === fragAntes - 10,
  `e cobrou exatamente 10 (${fragAntes} -> ${item(cli, FRAGMENTO_MEGA_ID)})`,
);
ok(
  cli.eventos.some((e) => e.k === 'megaStoneFabricada' && e.itemId === MEGA_STONE_POR_DEX[94]),
  'e o evento `megaStoneFabricada` chegou',
);

// O ataque pelo socket: `shiny` que não é o booleano `true` não pode cair na família shiny.
const shinyAntes = item(cli, FRAGMENTO_MEGA_SHINY_ID);
let avisosAntes = cli.avisos.length;
enviar(cli, { t: 'mega.fabricar', dex: 94, shiny: 'sim' });
await dormir(1500);
ok(item(cli, MEGA_SHINY_STONE_POR_DEX[94]) === 0, '`shiny: "sim"` (string) NAO entrega a pedra shiny');
ok(item(cli, FRAGMENTO_MEGA_SHINY_ID) === shinyAntes, 'e nao toca no fragmento shiny');

avisosAntes = cli.avisos.length;
const bolsaAntes = JSON.stringify(cli.eu?.items ?? {});
enviar(cli, { t: 'mega.fabricar', dex: 99999 });
await dormir(1500);
ok(cli.avisos.length > avisosAntes, 'dex forjado responde com aviso');
ok(JSON.stringify(cli.eu?.items ?? {}) === bolsaAntes, 'e nao mexe em um item sequer da bolsa');

// ------------------------------------------------------- megaevoluir de verdade

console.log('\n- megaevoluir');

ok(await ate(() => !!meuPk(cli, pkId)), 'o Gengar semeado aparece na conta');
const alvo = meuPk(cli, pkId);
const poderAntes = alvo?.poder ?? 0;
const pedrasAntes = item(cli, MEGA_STONE_POR_DEX[94]);

enviar(cli, { t: 'pokemon.mega', pokemonId: pkId });
ok(await ate(() => meuPk(cli, pkId)?.speciesId === megaPokeId(94)), 'o Gengar virou Mega Gengar (#3094)');

const mega = meuPk(cli, pkId);
ok(item(cli, MEGA_STONE_POR_DEX[94]) === pedrasAntes - 1, 'e gastou exatamente 1 Gengarite');
ok(mega?.nome === 'Mega Gengar', `o nome mudou (${mega?.nome})`);
ok(mega?.looktype === looktypeMega(94), `a arte e a da mega (${mega?.looktype})`);
ok((mega?.poder ?? 0) > poderAntes, `o poder subiu (${poderAntes} -> ${mega?.poder})`);
ok((mega?.tipos ?? []).join('/') === 'GHOST/POISON', `os tipos vieram da mega (${(mega?.tipos ?? []).join('/')})`);
ok(cli.eventos.some((e) => e.k === 'mega' && e.id === pkId), 'o evento `mega` chegou');

// De novo, no mesmo bicho: agora ele é o #3094, que não tem mega.
avisosAntes = cli.avisos.length;
const pedrasDepois = item(cli, MEGA_STONE_POR_DEX[94]);
enviar(cli, { t: 'pokemon.mega', pokemonId: pkId });
await dormir(1800);
ok(meuPk(cli, pkId)?.speciesId === megaPokeId(94), 'megaevoluir de novo nao muda a especie');
ok(item(cli, MEGA_STONE_POR_DEX[94]) === pedrasDepois, 'e nao cobra a segunda pedra');
ok(cli.avisos.length > avisosAntes, 'e responde com aviso');

// Um id que não é meu.
avisosAntes = cli.avisos.length;
enviar(cli, { t: 'pokemon.mega', pokemonId: 999999999 });
await dormir(1500);
ok(cli.avisos.length > avisosAntes, 'id de pokemon alheio/inexistente e recusado');

// --------------------------------------------------------------- a persistência

console.log('\n- a persistencia');
cli.ws.close();
// O flush de desconexão só acontece quando a carência vence; `admin.ban` derruba sem gravar,
// então aqui a gravação tem de ser a do PRÓPRIO jogo — o flush periódico (FLUSH_MS). Dois
// segundos e meio cobrem o padrão de dev.
await dormir(3000);

const noBanco = await pool.query('SELECT species_id FROM player_pokemon WHERE id = $1', [pkId]);
ok(Number(noBanco.rows[0]?.species_id) === megaPokeId(94), 'o banco guardou o #3094');

const cli2 = await abrir(await sessaoPara(NICK));
await ate(() => !!meuPk(cli2, pkId));
const depois = meuPk(cli2, pkId);
ok(depois?.speciesId === megaPokeId(94), 'e a mega volta no relogin');
ok(depois?.looktype === looktypeMega(94), 'com a arte certa');
cli2.ws.close();

await dormir(500);
await pool.end();
console.log('\n==============================================');
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `todos os ${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
