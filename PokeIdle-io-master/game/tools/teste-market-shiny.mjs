// O SHINY anunciado é o shiny entregue?
//
// `teste-market-global.mjs` prova as transações do mercado direto no Postgres. Este arquivo
// prova a outra metade, que só existe com o servidor de pé: o caminho completo de um pokémon
// SHINY saindo da mão de um jogador e chegando à do outro, pelo socket, com a ficha que a
// vitrine desenha no meio.
//
// A pergunta que ele responde é literal: **o bicho que aparece com ✨ na vitrine chega shiny
// na conta de quem pagou?** E ela não é retórica — a ficha do anúncio é um retrato congelado,
// e a linha de `player_pokemon` é a verdade. Se os dois divergirem, o comprador paga por um
// shiny e recebe um pokémon comum, e isso vale gema, ou seja, dinheiro de verdade.
//
// De quebra, confere o que a FICHA DETALHADA precisa carregar para o modal do anúncio poder
// existir: `speciesId` (que é o que resolve a arte certa — ver MECANICAS §5), `xp`, `ivs`,
// `stats` e `maxHp`.
//
// Precisa do servidor no ar (`npm start`) e do Postgres (`npm run infra`).
//
//   node tools/teste-market-shiny.mjs
import WebSocket from 'ws';
import { pool } from '../src/server/db.mjs';
import { especies, looktypeShiny, calcularStats, multDeNascenca } from '../src/server/content.mjs';
import { poderDePokemon } from '../src/shared/nota-pokemon.mjs';
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

// --------------------------------------------------------------- o shiny
//
// Charizard: tem forma shiny (looktype 9874 contra os 67 do comum) e é o caso que já mordeu
// de verdade — um anúncio antigo guardava o looktype do shiny com `shiny: false`.

const ESPECIE = 6;
const NIVEL = 87;
const QUALIDADE = 1.42;
const POTENCIA = 4;
const IVS = { hp: 28, atk: 30, def: 25, spAtk: 31, spDef: 27, speed: 26 };
const PRECO = 4242;

const esp = especies.get(ESPECIE);
const statsEsperados = calcularStats(esp, IVS, NIVEL, QUALIDADE, multDeNascenca(POTENCIA, true));
const poderEsperado = poderDePokemon({
  ivs: IVS, quality: QUALIDADE, potencia: POTENCIA, shiny: true, level: NIVEL,
});

const marca = Date.now() % 1000000;
const criarJogador = async (nick, ouro) => {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, gold, visual_ok) VALUES ($1, $2, true) RETURNING id`,
    [nick, ouro],
  );
  return Number(rows[0].id);
};
const inserirPokemon = async (donoId, { shiny, level = 5, quality = 1, ivs = IVS, potencia = 1, slot = null }) => {
  const { rows } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, xp, quality, ivs, hp, shiny, slot, potencia, power)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) RETURNING id`,
    [donoId, ESPECIE, level, 0, quality, JSON.stringify(ivs), 9999, shiny, slot, potencia, 1],
  );
  return Number(rows[0].id);
};

const nickVend = `shv${marca}`;
const nickComp = `shc${marca}`;
await sessaoPara(nickVend);
await sessaoPara(nickComp);
const vendedorId = await criarJogador(nickVend, 10_000);
const compradorId = await criarJogador(nickComp, 1_000_000);

// O vendedor precisa de DOIS: o último pokémon não pode ser anunciado, e o ativo também não.
await inserirPokemon(vendedorId, { shiny: false, slot: 0 });
const shinyId = await inserirPokemon(vendedorId, { shiny: true, level: NIVEL, quality: QUALIDADE, potencia: POTENCIA });

// ------------------------------------------------------------------ sockets

function abrir(nick) {
  const c = { ws: null, estado: null, avisos: [], mercado: null };
  const mesclar = criarMescladorDeEstado();
  return new Promise((res, rej) => {
    c.ws = new WebSocket(URL);
    c.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome' || m.t === 'estado') c.estado = mesclar(m.estado);
      if (m.t === 'market') c.mercado = m;
      if (m.t === 'batalha') for (const e of m.ev) if (e.k === 'aviso') c.avisos.push(e.msg);
      if (m.t === 'erro') c.avisos.push(`erro: ${m.msg}`);
    });
    c.ws.once('error', rej);
    c.ws.once('open', async () => {
      try {
        const sessao = await sessaoPara(nick);
        c.ws.send(JSON.stringify(helloCom(sessao)));
        res(c);
      } catch (err) {
        rej(err);
      }
    });
  });
}

async function esperar(pred, ms = 8000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (pred()) return true;
    await dormir(100);
  }
  return false;
}

const manda = (c, o) => c.ws.send(JSON.stringify(o));

const vend = await abrir(nickVend);
const comp = await abrir(nickComp);
if (!(await esperar(() => vend.estado && comp.estado))) throw new Error('o servidor não respondeu — está no ar?');

console.log(`vendedor ${nickVend} · comprador ${nickComp} · Shiny ${esp.name} Nv ${NIVEL} P${POTENCIA}`);

// ============================================================= o que o vendedor tem
secao('Antes de anunciar');
{
  const meu = vend.estado.pokemons.find((k) => k.id === shinyId);
  ok(!!meu, 'o shiny está na conta do vendedor');
  ok(meu?.shiny === true, 'e vem marcado como shiny');
  ok(
    meu?.lookShiny === looktypeShiny(ESPECIE),
    `com o looktype da forma shiny (${looktypeShiny(ESPECIE)})`,
    `veio ${meu?.lookShiny}`,
  );
  ok(meu?.looktype === esp.looktype, `e o looktype comum à parte (${esp.looktype})`, `veio ${meu?.looktype}`);
  ok(meu?.poder === poderEsperado, `o poder bate com a conta do servidor (${poderEsperado})`, `veio ${meu?.poder}`);
}

// ==================================================================== anunciar
secao('O anúncio');
manda(vend, { t: 'market.criar', tipo: 'pokemon', pokemonId: shinyId, preco: PRECO, moeda: 'gold' });
await esperar(() => vend.mercado?.aba === 'criado' || vend.avisos.length);
ok(vend.mercado?.aba === 'criado', 'o anúncio foi publicado', vend.avisos.join(' | '));

const anuncio = vend.mercado?.anuncio;
const ficha = anuncio?.ficha ?? {};
ok(ficha.shiny === true, 'a ficha do anúncio diz SHINY');
ok(ficha.speciesId === ESPECIE, 'e carrega a espécie — é ela que resolve a arte certa', `${ficha.speciesId}`);
ok(ficha.level === NIVEL, `o nível congelado é ${NIVEL}`, `${ficha.level}`);
ok(ficha.potencia === POTENCIA, `a potência congelada é P${POTENCIA}`, `${ficha.potencia}`);
ok(Math.abs((ficha.quality ?? 0) - QUALIDADE) < 1e-9, `a qualidade é ${QUALIDADE}`, `${ficha.quality}`);

secao('A ficha detalhada — o que o modal do anúncio precisa');
ok(typeof ficha.xp === 'number', 'a ficha traz o XP', `${ficha.xp}`);
ok(!!ficha.ivs && Object.keys(ficha.ivs).length === 6, 'os seis IVs', JSON.stringify(ficha.ivs));
ok(
  JSON.stringify(ficha.stats) === JSON.stringify(statsEsperados),
  'os stats já calculados, com potência e shiny dentro',
  `${JSON.stringify(ficha.stats)} ≠ ${JSON.stringify(statsEsperados)}`,
);
ok(typeof ficha.maxHp === 'number' && ficha.maxHp > 0, 'e o HP de combate', `${ficha.maxHp}`);
ok(
  ficha.ivTotal === Object.values(IVS).reduce((s, v) => s + v, 0),
  'o IV somado bate com os seis',
  `${ficha.ivTotal}`,
);

secao('O escrow');
{
  await esperar(() => !vend.estado.pokemons.some((k) => k.id === shinyId));
  ok(!vend.estado.pokemons.some((k) => k.id === shinyId), 'o shiny saiu da mão do vendedor');
  const linha = (await pool.query(`SELECT anuncio_id, shiny FROM player_pokemon WHERE id=$1`, [shinyId])).rows[0];
  ok(Number(linha.anuncio_id) === anuncio.id, 'e ficou preso ao anúncio no banco');
  ok(linha.shiny === true, 'a linha do banco continua shiny — o escrow não mexe no bicho');
}

// ============================================================= a vitrine
secao('A vitrine, do lado do comprador');
manda(comp, { t: 'market.listar', tipo: 'pokemon', soShiny: true, ordem: 'recentes', pagina: 0 });
await esperar(() => comp.mercado?.aba === 'vitrine');
const naVitrine = (comp.mercado?.linhas ?? []).find((l) => l.id === anuncio.id);
ok(!!naVitrine, 'o anúncio aparece com o filtro "só shiny" ligado');
ok(naVitrine?.ficha?.shiny === true, 'marcado como shiny na vitrine');
ok(naVitrine?.preco === PRECO, `pelo preço anunciado (${PRECO})`, `${naVitrine?.preco}`);

// ============================================================= a compra
secao('A compra');
const ouroAntes = comp.estado.gold;
manda(comp, { t: 'market.comprar', id: anuncio.id, qtd: 1, preco: naVitrine.preco, moeda: naVitrine.moeda });
await esperar(() => comp.estado.pokemons.some((k) => k.speciesId === ESPECIE && k.level === NIVEL), 10000);

const recebido = comp.estado.pokemons.find((k) => k.speciesId === ESPECIE && k.level === NIVEL);
ok(!!recebido, 'o pokémon chegou na conta do comprador', comp.avisos.join(' | '));
ok(recebido?.shiny === true, '★ E ELE É SHINY', `shiny=${recebido?.shiny}`);
ok(recebido?.level === NIVEL, `com o nível anunciado (${NIVEL})`, `${recebido?.level}`);
ok(recebido?.potencia === POTENCIA, `a potência anunciada (P${POTENCIA})`, `${recebido?.potencia}`);
ok(Math.abs((recebido?.quality ?? 0) - QUALIDADE) < 1e-9, `a qualidade anunciada (${QUALIDADE})`, `${recebido?.quality}`);
ok(
  JSON.stringify(recebido?.stats) === JSON.stringify(statsEsperados),
  'e os stats são exatamente os da ficha',
  `${JSON.stringify(recebido?.stats)}`,
);
ok(
  recebido?.lookShiny === looktypeShiny(ESPECIE),
  'a arte que vai ser desenhada é a da forma shiny',
  `${recebido?.lookShiny}`,
);
ok(comp.estado.gold === ouroAntes - PRECO, `o ouro saiu certo (−${PRECO})`, `${ouroAntes} → ${comp.estado.gold}`);

secao('E do lado do banco');
{
  const linha = (await pool.query(`SELECT player_id, shiny, anuncio_id, slot FROM player_pokemon WHERE id=$1`, [shinyId])).rows[0];
  ok(Number(linha.player_id) === compradorId, 'a linha trocou de dono');
  ok(linha.shiny === true, 'continua shiny no banco — é a MESMA linha, não uma cópia');
  ok(linha.anuncio_id === null, 'e saiu do escrow');
  ok(Number(recebido.id) === shinyId, 'o id entregue é o do pokémon anunciado', `${recebido.id} ≠ ${shinyId}`);
}

// ==================================================== a invariante, no mundo todo
//
// O teste acima prova um caso. Esta varredura prova a REGRA: em nenhum anúncio aberto de
// pokémon a ficha pode dizer uma coisa e a linha dizer outra. É o que pegaria um anúncio
// antigo (ou criado por um caminho que ninguém lembra) prometendo brilho que não existe.
secao('Nenhum anúncio aberto mente sobre o brilho');
{
  const { rows } = await pool.query(
    `SELECT a.id, a.ficha->>'shiny' AS ficha_shiny, pp.shiny AS real_shiny,
            a.ficha->>'level' AS ficha_level, pp.level AS real_level,
            a.ficha->>'speciesId' AS ficha_esp, pp.species_id AS real_esp
       FROM market_anuncios a JOIN player_pokemon pp ON pp.id = a.pokemon_id
      WHERE a.estado = 'aberto' AND a.tipo = 'pokemon'`,
  );
  const mentemShiny = rows.filter((r) => (r.ficha_shiny === 'true') !== r.real_shiny);
  const mentemNivel = rows.filter((r) => r.ficha_level != null && Number(r.ficha_level) !== r.real_level);
  const mentemEspecie = rows.filter((r) => r.ficha_esp != null && Number(r.ficha_esp) !== r.real_esp);

  ok(rows.length > 0, `${rows.length} anúncio(s) de pokémon abertos para conferir`);
  ok(!mentemShiny.length, 'o brilho da ficha bate com o do pokémon', mentemShiny.map((r) => `#${r.id}`).join(', '));
  ok(!mentemNivel.length, 'o nível também', mentemNivel.map((r) => `#${r.id}`).join(', '));
  ok(!mentemEspecie.length, 'e a espécie', mentemEspecie.map((r) => `#${r.id}`).join(', '));
}

// ------------------------------------------------------------------ limpeza
vend.ws.close();
comp.ws.close();
await dormir(1200); // deixa o flush do disconnect fechar antes de apagar as linhas
await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [[vendedorId, compradorId]]).catch(() => {});
await pool.end();

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
