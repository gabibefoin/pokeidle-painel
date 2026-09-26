// A ÁREA DE TREINAMENTO — a bancada de testes do PvP, sem banco e sem Redis.
//
// O que este teste protege, em ordem de importância:
//
//   1. NADA É GERADO. O pokémon de teste não vira linha nenhuma, o pokémon do jogador não é
//      tocado pela luta (o simulador machuca uma cópia), e o retorno não tem XP, Coin, item nem
//      ponto de PvP. As duas primeiras coisas se provam rodando a luta e comparando o antes e o
//      depois; a terceira, lendo o fonte do comando no sim;
//   2. o pacote da tela não manda nos números: IV, qualidade, potência e nível são presos na
//      faixa, espécie inventada é recusada, e pokémon que não é do jogador não entra;
//   3. os dois lados são independentes (5 × 1 é válido) e o teto de 5 por lado vale;
//   4. a espera de 5 min por conta é reivindicada uma vez só.
//
//   node tools/teste-treino.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { especies } from '../src/server/content.mjs';
import {
  TREINO_COOLDOWN_MS, TREINO_MAX_LADO, TREINO_NIVEL_MAX,
  normalizarLado, normalizarPokemonTeste, pokemonTestePadrao,
} from '../src/shared/treino.mjs';
import { IV_POR_STAT, POTENCIA_MAX, QUALIDADE_MAX, QUALIDADE_MIN } from '../src/shared/nota-pokemon.mjs';
import { _testeMontarLado, devolverVez, lutaDeTreino, reivindicarVez, ErroTreino } from '../src/server/game/treino.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
const secao = (s) => console.log(`\n${s}`);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel) => readFileSync(join(raiz, rel), 'utf8').replace(/\r\n/g, '\n');
const erroDe = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

const ESPECIE = [...especies.values()][0].pokeId;
const ivsCheios = { hp: 32, atk: 32, def: 32, spAtk: 32, spDef: 32, speed: 32 };

/** Um pokémon do jogador, como o sim o guarda em memória (`montarPokemon`). */
const meuPokemon = (id, speciesId = ESPECIE) => ({
  id, speciesId, level: 120, ivs: { ...ivsCheios }, quality: 1.1, potencia: 3,
  shiny: false, refino: null, tmElemental: null, hp: 999, slot: null,
});
const jogador = (pokemons) => ({
  dbId: 4242, nick: 'treinador', looktype: 159, visual: null,
  pokemons: new Map(pokemons.map((k) => [k.id, k])),
});

// ------------------------------------------------------------------ as regras
secao('A peneira do pokémon de teste');
{
  const t = normalizarPokemonTeste({
    speciesId: ESPECIE, level: 999999, shiny: 'sim', potencia: 99, qualidade: 99,
    ivs: { hp: 999, atk: -5, def: 32, spAtk: 'x', spDef: 1, speed: 16 },
  });
  ok(t.level === TREINO_NIVEL_MAX, `nível é preso no teto (${t.level})`);
  ok(t.potencia === POTENCIA_MAX, `potência é presa em ${POTENCIA_MAX}`);
  ok(t.qualidade === QUALIDADE_MAX, `qualidade é presa em ${QUALIDADE_MAX}`, `${t.qualidade}`);
  ok(t.ivs.hp === IV_POR_STAT.max && t.ivs.atk === IV_POR_STAT.min, 'IV acima do teto e abaixo do piso são presos');
  ok(t.ivs.spAtk === IV_POR_STAT.min, 'IV que não é número vira o piso');
  ok(t.shiny === true, 'shiny vira booleano');
  const baixo = normalizarPokemonTeste({ speciesId: ESPECIE, level: 0, qualidade: 0, potencia: 0 });
  ok(baixo.level === 1 && baixo.qualidade === QUALIDADE_MIN && baixo.potencia === 1, 'e os pisos valem também');
  ok(normalizarPokemonTeste({ speciesId: 0 }) === null && normalizarPokemonTeste(null) === null,
    'sem espécie não há pokémon de teste');
  ok(normalizarPokemonTeste({ speciesId: ESPECIE }).ivs.hp === IV_POR_STAT.min,
    'campo ausente cai no piso, e não em `undefined`');
  const padrao = pokemonTestePadrao(ESPECIE);
  ok(padrao.speciesId === ESPECIE && padrao.level === 100, 'o padrão do formulário é nível 100');
}

secao('A peneira do lado');
{
  const cheio = normalizarLado(Array.from({ length: 12 }, (_, i) => ({ meu: i + 1 })));
  ok(cheio.length === TREINO_MAX_LADO, `corta no teto de ${TREINO_MAX_LADO} casas`, `${cheio.length}`);
  const lado = normalizarLado([
    { meu: 7 }, { meu: 'x' }, null, { teste: { speciesId: ESPECIE } }, { teste: { speciesId: 0 } },
  ]);
  ok(lado.length === 2 && lado.every((c) => c.meu != null || c.teste), 'casa torta some da lista', `${lado.length}`);
  ok(normalizarLado('nada').length === 0 && normalizarLado(null).length === 0, 'o que não é lista vira lado vazio');
}

// ------------------------------------------------------------ a montagem
secao('A montagem dos lutadores');
{
  const p = jogador([meuPokemon(1), meuPokemon(2)]);
  const lado = _testeMontarLado(p, [
    { meu: 1 }, { meu: 999 }, { teste: { speciesId: ESPECIE, level: 50 } },
    { teste: { speciesId: 987654321, level: 50 } },
  ]);
  ok(lado.length === 2, 'pokémon que não é do jogador e espécie inexistente ficam de fora', `${lado.length}`);
  ok(lado.every((k) => k.id < 0), 'todo lutador tem id NEGATIVO — não casa com linha nenhuma do banco',
    JSON.stringify(lado.map((k) => k.id)));
  ok(new Set(lado.map((k) => k.id)).size === lado.length, 'e os ids não se repetem');
  const copia = lado[0];
  ok(copia !== p.pokemons.get(1) && copia.ivs !== p.pokemons.get(1).ivs,
    'o lutador é uma CÓPIA do pokémon do jogador (nem o objeto nem os IVs são os mesmos)');
  ok(copia.speciesId === p.pokemons.get(1).speciesId && copia.level === p.pokemons.get(1).level
    && copia.quality === p.pokemons.get(1).quality && copia.potencia === p.pokemons.get(1).potencia,
  'com os mesmos números de nascimento');
  ok(lado[1].quality <= QUALIDADE_MAX && lado[1].refino === null && lado[1].tmElemental === null,
    'o pokémon de teste entra sem refino e sem TM');
}

// ------------------------------------------------------------ a batalha
secao('A batalha (o simulador de verdade)');
{
  const p = jogador([meuPokemon(1), meuPokemon(2), meuPokemon(3)]);
  const antes = JSON.stringify([...p.pokemons.values()]);
  const r = await lutaDeTreino(p, {
    a: [{ meu: 1 }, { meu: 2 }, { meu: 3 }],
    b: [{ teste: { speciesId: ESPECIE, level: 150, shiny: true, potencia: 5, qualidade: QUALIDADE_MAX, ivs: ivsCheios } }],
  });
  ok(!!r.replay && Array.isArray(r.replay.atores), 'devolve a fita para assistir');
  ok(typeof r.venceuA === 'boolean' && r.ladoA === 3 && r.ladoB === 1, '3 × 1 é uma luta válida (lados independentes)');
  ok(r.cooldownMs === TREINO_COOLDOWN_MS, 'e diz quanto tempo até a próxima');
  ok(JSON.stringify([...p.pokemons.values()]) === antes,
    'os pokémon DO JOGADOR saem da luta exatamente como entraram (HP inclusive)');
  const chaves = Object.keys(r);
  const proibidas = chaves.filter((k) => /xp|gold|coin|ouro|item|pedra|premio|pontos|elo|recompensa/i.test(k));
  ok(!proibidas.length, 'o retorno não tem nenhum campo de ganho', proibidas.join(', '));
  const texto = JSON.stringify(r);
  ok(!/"(xp|gold|ouro|drop|premio)"\s*:/i.test(texto), 'nem escondido dentro da fita');

  const vazio = await erroDe(() => lutaDeTreino(p, { a: [{ meu: 1 }], b: [] }));
  ok(vazio instanceof ErroTreino && vazio.message === 'treino.recusa.vazio', 'lado sem ninguém é recusado');
  const soLixo = await erroDe(() => lutaDeTreino(p, { a: [{ meu: 404 }], b: [{ meu: 1 }] }));
  ok(soLixo instanceof ErroTreino, 'lado só com pokémon que não é dele também');
}

// ------------------------------------------------------------ a espera
secao('A espera de 5 minutos');
{
  const primeira = await reivindicarVez(90001);
  const segunda = await reivindicarVez(90001);
  ok(primeira.ok, 'a primeira batalha passa');
  ok(!segunda.ok, 'a segunda é recusada na mesma janela');
  ok(segunda.restaMs > 0 && segunda.restaMs <= TREINO_COOLDOWN_MS, 'e a recusa diz quanto falta', `${segunda.restaMs}`);
  await devolverVez(90001);
  ok((await reivindicarVez(90001)).ok, 'devolver a vez libera de novo (a luta que não aconteceu não cobra espera)');
  await devolverVez(90001);
  ok((await reivindicarVez(90002)).ok, 'a espera é por conta, não global');
  // A espera vive no Redis por 5 minutos e não sabe que isto é um teste: sem devolver a última
  // vez, rodar o arquivo duas vezes seguidas falharia por causa da execução anterior.
  await devolverVez(90002);
}

// ------------------------------------------------------ o que o fonte promete
secao('No fonte: o comando não escreve nada');
{
  const sim = ler('src/server/sim.mjs');
  const i = sim.indexOf("  'treino.lutar': (p, m) => {");
  const handler = sim.slice(i, sim.indexOf('\n  },', i));
  ok(i > 0, 'o comando existe');
  const proibido = ['marcarSujo', 'somarGold', 'subtrairGold', 'db.', 'pool.query', 'inserirPokemon', 'p.items', 'p.gold', 'p.xp'];
  const achados = proibido.filter((k) => handler.includes(k));
  ok(!achados.length, 'e não chama nada que grave ou credite', achados.join(', '));
  ok(handler.includes('reivindicarVez(p.dbId)') && handler.indexOf('reivindicarVez') < handler.indexOf('lutaDeTreino'),
    'a espera é reivindicada ANTES de montar a luta');
  ok(handler.includes('devolverVez(p.dbId)'), 'e devolvida quando a luta não acontece');

  const mod = ler('src/server/game/treino.mjs');
  const escritas = ['INSERT', 'UPDATE ', 'DELETE', 'pool.query', 'gravarPokemon', 'inserirPokemon'];
  ok(!escritas.some((k) => mod.includes(k)), 'o módulo do treino não tem escrita nenhuma');
  const noRedis = [...new Set([...mod.matchAll(/pub\.(\w+)\(/g)].map((m) => m[1]))].sort();
  ok(JSON.stringify(noRedis) === JSON.stringify(['del', 'pttl', 'set']) && mod.includes("'NX'"),
    'o único toque no Redis é o carimbo da espera (SET NX, o TTL e a devolução)', noRedis.join(', '));
  ok(mod.includes('comPrazo(pub.set('), 'e ele tem prazo — Redis fora do ar não pendura o jogador');
  ok(mod.includes('const id = proximo();'), 'os dois lados dividem o contador de ids negativos');
}

secao('No fonte: a tela');
{
  const app = ler('src/client/app.js');
  ok(app.includes('data-aba="treino"') && app.includes('id="pvp-painel-treino"'),
    'a aba Treinamento existe no modal do PvP');
  ok(app.includes("if (aba === 'treino') return pintarTreino();"), 'e pinta a bancada quando é a aba aberta');
  ok(app.includes("else if (m.t === 'treino') aoReceberTreino(m);"), 'a resposta do servidor é despachada');
  const lutar = app.slice(app.indexOf('function lutarTreino()'), app.indexOf('function tiqueTreino()'));
  ok(lutar.includes("enviar({ t: 'treino.lutar', a: casasDoLado('a'), b: casasDoLado('b') });"),
    'o pedido leva só as duas listas de casas — nada de stat pronto');
  const form = app.slice(app.indexOf('function abrirFormDeTeste('), app.indexOf('function lutarTreino()'));
  ok(form.includes('normalizarPokemonTeste({'), 'o formulário passa pela mesma peneira do servidor');
  // Só o corpo da função: até o fecha-chaves da coluna 0. Sem esse limite o recorte ia até o
  // fim do arquivo e acusava o código de outra tela.
  const iReceber = app.indexOf('function aoReceberTreino(');
  const receber = app.slice(iReceber, app.indexOf('\n}\n', iReceber));
  ok(!/estado\.eu\.(gold|xp|items|pokemons)\s*=/.test(receber), 'a resposta não mexe em nada do jogador');
}

console.log(`\n${testes - falhas}/${testes} ok`);
if (falhas) console.log(`${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
