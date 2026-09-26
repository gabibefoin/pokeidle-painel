#!/usr/bin/env node
/**
 * Kit de gravação da OFERENDA — os shinys das quatro famílias do roteiro + Tyranitar comum.
 *
 *   node tools/dar-oferenda-teste.mjs fasi
 *   node tools/dar-oferenda-teste.mjs fasi --dry-run
 *   node tools/dar-oferenda-teste.mjs fasi --destravar   (desliga o Auto Lock de shiny)
 *
 * ### O que ele põe, e por quê
 *
 * Quatro famílias de shiny, dez de cada, escolhidas para cobrir os três casos da regra nova:
 *
 *   · **Dratini** (DRAGON) — tipo único: a roleta dele só pode dar Dragon Shiny Stone;
 *   · **Charmander** (FIRE) — tipo único também, para comparar duas fatias de cor diferente;
 *   · **Bulbasaur** (GRASS/POISON) e **Gengar** (GHOST/POISON) — dual-type: cada um abre DUAS
 *     Shiny Stones, e os dois dividem a de POISON, que é o caso em que duas espécies somam na
 *     mesma fatia.
 *
 * E **100 Tyranitar comuns** (ROCK/DARK), que servem para a mistura: quatro deles mais um shiny
 * fecham as cinco casas e desenham a roleta com as duas prateleiras no mesmo círculo — Rock Stone
 * e Darkness Stone comuns disputando com a Shiny Stone do bicho raro.
 *
 * Qualidade, potência e IV saem das ROLAGENS DE VERDADE do jogo (`rolarQualidade`,
 * `rolarPotencia`, `rolarIVsShiny`) — nada de número redondo escrito à mão, senão o vídeo mostra
 * uma ficha que o jogo nunca produziria. A exceção é **um de cada família**, que sai P5 com
 * qualidade do topo e IV alto: é o "shiny bom" que a câmera precisa ter para mostrar.
 *
 * ### O Auto Lock vai barrar, e isso é de propósito
 *
 * Shiny nasce TRANCADO no cadeado de venda (`autoLockShiny`, ligado por padrão), e a oferenda
 * recusa pokémon trancado — é a rede de segurança que impede alguém de queimar o item mais raro
 * que tem num clique errado. Para gravar, ou se destrava cada um na ficha, ou se desliga o Auto
 * Lock (na tela, ou com `--destravar` aqui).
 *
 * O jogador precisa reconectar (F5) se estiver online: o depot vem do banco na entrada, e o
 * flush do sim grava por cima do que for editado com a conta carregada.
 */
import '../src/server/config.mjs';
import { pool, inserirPokemon } from '../src/server/db.mjs';
import { pub, PRESENCA } from '../src/server/bus.mjs';
import {
  especies,
  calcularStats,
  hpDeCombate,
  xpTotalParaNivel,
  multDeNascenca,
  rolarQualidade,
  rolarPotencia,
  rolarIVsShiny,
  rolarIVs,
} from '../src/server/content.mjs';
import { QUALIDADE_MAX, POTENCIA_MAX, poderDePokemon } from '../src/shared/nota-pokemon.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const destravar = args.includes('--destravar');
// O padrão é `fasi`, o mesmo do `dar-kit-shiny-teste.mjs` ao lado — a conta de testes da casa.
const nick = args.find((a) => !a.startsWith('--')) ?? 'fasi';

/** O teto de captura do jogo. Um bicho acima disso não teria como existir numa conta honesta. */
const LEVEL = 100;

const FAMILIAS = [
  { nome: 'Dratini', qtd: 10, shiny: true },
  { nome: 'Bulbasaur', qtd: 10, shiny: true },
  { nome: 'Charmander', qtd: 10, shiny: true },
  { nome: 'Gengar', qtd: 10, shiny: true },
  { nome: 'Tyranitar', qtd: 100, shiny: false },
];

/** IV alto, mas ainda sorteado: 30 a 32 por stat. "Bom", não "perfeito de planilha". */
const ivAlto = () => {
  const r = () => 30 + Math.floor(Math.random() * 3);
  return { hp: r(), atk: r(), def: r(), spAtk: r(), spDef: r(), speed: r() };
};

const somaIv = (ivs) => Object.values(ivs).reduce((s, v) => s + v, 0);

const especiePorNome = (nome) =>
  [...especies.values()].find((e) => e.name.toLowerCase() === nome.toLowerCase());

const { rows } = await pool.query(
  `SELECT id, nick FROM players WHERE lower(nick) = lower($1)`,
  [nick],
);
if (!rows[0]) {
  console.error(`Jogador "${nick}" não encontrado no banco local.`);
  process.exit(1);
}
const playerId = Number(rows[0].id);
// `pub.connect()` e não `conectarBus()`: aquele levanta TAMBÉM o `sub` e pendura os handlers de
// pub/sub do jogo, que uma ferramenta de linha de comando não tem o que fazer com — e o processo
// ficaria vivo esperando mensagem que nunca vem. Aqui só se precisa de uma leitura.
await pub.connect().catch(() => {});

// Conta carregada num sim = flush grava por cima, e o kit some sem deixar rastro. Quem sabe se
// ela está online é o REDIS (o hash `presenca`, indexado pelo nick minúsculo), e não o Postgres:
// não existe coluna de "último online" na tabela, e uma checagem que consulta uma coluna
// inexistente é pior que nenhuma — ela devolve "pode" para sempre, calada.
const online = await pub.hget(PRESENCA, rows[0].nick.toLowerCase()).catch(() => null);
if (online) {
  console.error(`! "${rows[0].nick}" está ONLINE agora (gateway ${online}).`);
  console.error("  Saia do jogo antes: o flush do sim grava a coleção que ele tem em memória");
  console.error("  por cima desta, e os pokémon novos somem no primeiro tick.");
  await pool.end();
  await pub.quit().catch(() => {});
  process.exit(1);
}

console.log(`\n=== Kit da Oferenda → ${rows[0].nick} (id ${playerId}) ===`);
console.log(`Nível ${LEVEL} · qualidade/potência/IV sorteados pelo próprio jogo\n`);

const xp = xpTotalParaNivel(LEVEL);
let total = 0;

for (const fam of FAMILIAS) {
  const esp = especiePorNome(fam.nome);
  if (!esp) {
    console.warn(`  ! espécie "${fam.nome}" ausente do catálogo — pulando`);
    continue;
  }
  const tipos = [esp.type1, esp.type2].filter(Boolean).join('/');
  console.log(`${fam.shiny ? '✨ ' : '   '}${esp.name} (${tipos}) ×${fam.qtd}`);

  for (let i = 0; i < fam.qtd; i++) {
    // O PRIMEIRO de cada família shiny é o bom: P5, qualidade do topo, IV alto. O resto sai
    // como o jogo sorteia — é o contraste que faz a ficha do bom significar alguma coisa.
    const destaque = fam.shiny && i === 0;
    const ivs = destaque ? ivAlto() : (fam.shiny ? rolarIVsShiny() : rolarIVs());
    const quality = destaque ? QUALIDADE_MAX : rolarQualidade();
    const potencia = destaque ? POTENCIA_MAX : rolarPotencia();
    const stats = calcularStats(esp, ivs, LEVEL, quality, multDeNascenca(potencia, fam.shiny));
    const pk = {
      speciesId: esp.pokeId,
      level: LEVEL,
      xp,
      quality,
      ivs: JSON.stringify(ivs),
      hp: hpDeCombate(stats.hp),
      shiny: fam.shiny,
      slot: null,
      potencia,
      power: poderDePokemon({ ivs, quality, potencia, shiny: fam.shiny, level: LEVEL }),
      starter: false,
    };
    if (destaque || i === 0) {
      const rotulo = destaque ? '  ★ destaque' : '';
      console.log(
        `   ${destaque ? '★' : '·'} P${potencia} q${quality.toFixed(2)} IV${somaIv(ivs)} ⚔${pk.power}${rotulo}`,
      );
    }
    if (dryRun) continue;
    await inserirPokemon(playerId, pk);
    total++;
  }
}

if (destravar && !dryRun) {
  await pool.query(
    `UPDATE players
        SET automation = jsonb_set(coalesce(automation, '{}'::jsonb), '{autoLockShiny}', 'false')
      WHERE id = $1`,
    [playerId],
  );
  console.log('\nAuto Lock de shiny DESLIGADO (--destravar).');
}

console.log(`\n${dryRun ? '[dry-run] nada gravado' : `${total} pokémon criados`}.`);
if (!destravar) {
  console.log(
    'Os shinys nascem TRANCADOS no cadeado (Auto Lock), e a oferenda recusa trancado.\n'
    + 'Para gravar: desligue o Auto Lock na tela, destrave um a um na ficha, ou rode de novo com --destravar.',
  );
}
console.log('Reconecte no jogo (F5) para ver o depot.');
await pool.end();
await pub.quit().catch(() => {});
