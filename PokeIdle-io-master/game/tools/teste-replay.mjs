// O PLAYER do replay da Guerra de Guilds, rodando fora do navegador.
//
// A gravação é conferida do outro lado em `teste-guild-pvp.mjs`; aqui a pergunta é a inversa:
// o cliente consegue reidratar aquela fita? É o trecho de código com mais chance de quebrar
// em silêncio — um índice trocado num `[slot, coluna, linha]` não estoura nada, só desenha a
// batalha errada.
//
// Para isso o DOM é substituído por um mínimo que o `campo.mjs` aceita: canvas de mentira,
// nenhum sprite, nenhum mapa. O que se testa é o ESTADO — posição, HP, quem saiu do mapa, a
// câmera e a busca na linha do tempo —, não o desenho.
//
//   node tools/teste-replay.mjs

import { simularGuerra } from '../src/server/game/guild-pvp-sim.mjs';
import { especies, calcularStats, hpDeCombate, multDeNascenca } from '../src/server/content.mjs';

// ------------------------------------------------------------------ o "navegador"

const nada = new Proxy(() => nada, { get: () => nada, apply: () => nada });
const canvasFalso = () => ({
  width: 800,
  height: 450,
  clientWidth: 800,
  clientHeight: 450,
  parentElement: null,
  getContext: () => nada,
  // O player liga o arrasto no canvas (`ligarArrasto`) já no construtor.
  addEventListener: () => {},
  removeEventListener: () => {},
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }),
  style: {},
});

// `documentElement.classList` não é enfeite: `preferencias.mjs` aplica o tema no import, e
// `campo.mjs` pergunta a ela pelo MODO OTIMIZADO antes de desenhar cada golpe.
const classListFalsa = () => ({
  toggle: () => {},
  add: () => {},
  remove: () => {},
  contains: () => false,
});
globalThis.document = {
  documentElement: { classList: classListFalsa() },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: canvasFalso,
};
globalThis.Image = class {
  set src(_) {
    setTimeout(() => this.onerror?.(new Error('sem rede no teste')), 0);
  }
};
globalThis.fetch = () => Promise.reject(new Error('sem rede no teste'));
// O modo otimizado mora aqui (`preferencias.mjs`), e é o que desliga toda a animação de
// golpe. `prefs` é o que deixa o teste ligar e desligar isso no meio da fita.
const prefs = new Map();
globalThis.localStorage = {
  getItem: (k) => prefs.get(k) ?? null,
  setItem: (k, v) => prefs.set(k, String(v)),
};
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
// Sem laço de animação: o teste avança o relógio na mão, e um `requestAnimationFrame` de
// verdade deixaria o processo vivo para sempre depois do último `ok`.
globalThis.requestAnimationFrame = () => 0;

const { ReplayGuerra } = await import('../src/client/replay.mjs');

// ------------------------------------------------------------------ o de sempre

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const IVS = { hp: 24, atk: 24, def: 24, spAtk: 24, spDef: 24, speed: 24 };
const pokemonFalso = (speciesId, nivel) => {
  const esp = especies.get(speciesId);
  const stats = calcularStats(esp, IVS, nivel, 1.2, multDeNascenca(1, false));
  return {
    id: Math.floor(Math.random() * 1e9),
    speciesId,
    nome: esp.name,
    looktype: esp.looktype,
    lookShiny: null,
    tipos: [esp.type1, esp.type2].filter(Boolean),
    level: nivel,
    shiny: false,
    stats,
    maxHp: hpDeCombate(stats.hp),
    tmElemental: null,
  };
};
const guildFalsa = (id, n, nivel, mons) => ({
  id,
  nome: `Guild${id}`,
  brasao: null,
  membros: Array.from({ length: n }, (_, i) => ({
    playerId: id * 1000 + i,
    nick: `G${id}m${i}`,
    looktype: 159,
    visual: [78, 69, 114, 114],
    equipe: mons.map((s) => pokemonFalso(s, nivel)),
  })),
});

console.log('PLAYER DO REPLAY\n================');

const guerra = await simularGuerra(
  [guildFalsa(1, 4, 85, [6, 9]), guildFalsa(2, 4, 82, [9, 3]), guildFalsa(3, 4, 88, [3, 6])],
  { aoRespirar: () => new Promise((r) => setImmediate(r)) },
);
const rep = guerra.replay;

const novoPlayer = () => {
  const p = new ReplayGuerra(canvasFalso(), rep);
  p.iniciar();
  return p;
};

secao('A cena nasce igual à gravação');
{
  const p = novoPlayer();
  ok(p.campo.mobs.size === rep.atores.length, 'todo ator entrou em campo', `${p.campo.mobs.size}`);
  ok(p.duracao === rep.dur, 'a duração é a da fita');

  let posErrada = 0;
  for (let i = 0; i + 2 < rep.inicio.length; i += 3) {
    const e = p.campo.mobs.get(rep.inicio[i]);
    if (!e || e.cx !== rep.inicio[i + 1] || e.cy !== rep.inicio[i + 2]) posErrada++;
  }
  ok(!posErrada, 'cada um nasce na coluna/linha gravada', `${posErrada} fora do lugar`);

  const heroi = rep.atores.find((a) => !a.tr);
  const e = p.campo.mobs.get(heroi.s);
  ok(e.nome === heroi.n && e.level === heroi.nv, 'nome e nível vêm do ator');
  ok(e.maxHp === heroi.mhp && e.hp === heroi.hp, 'a barra de HP começa cheia');
  const treinador = rep.atores.find((a) => a.tr);
  ok(p.campo.mobs.get(treinador.s).ehTreinador === true, 'o boneco do treinador é marcado como tal');
  ok(p.campo.mobs.get(treinador.s).maxHp === undefined, 'e não ganha barra de vida');
  p.destruir();
}

secao('Tocar a fita inteira chega ao mesmo estado do servidor');
{
  const p = novoPlayer();
  p.irPara(rep.dur);

  const caidos = new Set(rep.quadros.flatMap((q) => q.m ?? []));
  const removidos = new Set(rep.quadros.flatMap((q) => q.x ?? []));
  ok(
    [...removidos].every((s) => !p.campo.mobs.has(s)),
    'quem saiu do mapa não está mais na cena',
  );
  ok([...caidos].every((s) => p.estado.get(s)?.fora), 'todo caído está marcado como fora');

  // `instantaneo().guilds` traz só as que ainda estão de pé (ver `MAX_PLACAR`), com o índice
  // da guild na gravação — é o que a interface desenha no placar flutuante.
  const fim = p.instantaneo();
  ok(fim.guilds.length === 1, 'sobrou exatamente uma guild em pé', `${fim.guilds.length}`);
  ok(
    fim.guildsFora === rep.guilds.length - 1,
    'as eliminadas viram um contador',
    `${fim.guildsFora} de ${rep.guilds.length - 1}`,
  );
  ok(
    rep.guilds[fim.guilds[0].idx].id === guerra.vencedorId,
    'a guild que sobrou é a vencedora do servidor',
    `${rep.guilds[fim.guilds[0].idx].id} ≠ ${guerra.vencedorId}`,
  );
  p.destruir();
}

secao('A posição final bate quadro a quadro com a gravação');
{
  const p = novoPlayer();
  p.irPara(rep.dur);

  // Reconstrução independente: o último destino gravado de cada slot é onde ele tem de estar.
  const esperado = new Map();
  for (let i = 0; i + 2 < rep.inicio.length; i += 3) {
    esperado.set(rep.inicio[i], [rep.inicio[i + 1], rep.inicio[i + 2]]);
  }
  const hp = new Map();
  for (const q of rep.quadros) {
    for (let i = 0; q.p && i + 2 < q.p.length; i += 3) esperado.set(q.p[i], [q.p[i + 1], q.p[i + 2]]);
    for (let i = 0; q.h && i + 1 < q.h.length; i += 2) hp.set(q.h[i], q.h[i + 1]);
    for (const c of q.c ?? []) hp.set(c.s, c.hp);
  }

  let posErrada = 0;
  let hpErrado = 0;
  for (const [slot, [cx, cy]] of esperado) {
    const e = p.campo.mobs.get(slot);
    if (!e) continue; // saiu do mapa: `irPara` já removeu
    if (e.cx !== cx || e.cy !== cy) posErrada++;
  }
  for (const [slot, v] of hp) {
    const e = p.campo.mobs.get(slot);
    if (e && e.hp !== v) hpErrado++;
  }
  ok(!posErrada, 'nenhuma entidade parou na tile errada', `${posErrada}`);
  ok(!hpErrado, 'nenhum HP divergiu da gravação', `${hpErrado}`);
  p.destruir();
}

secao('Buscar para trás remonta a cena, não a acumula');
{
  const p = novoPlayer();
  const noComeco = [...p.campo.mobs.values()].map((e) => `${e.slot}:${e.cx},${e.cy}`).sort().join('|');

  p.irPara(rep.dur);
  const noFim = [...p.campo.mobs.values()].map((e) => `${e.slot}:${e.cx},${e.cy}`).sort().join('|');
  ok(noFim !== noComeco, 'a guerra realmente mexeu a cena');

  p.irPara(0);
  const devolta = [...p.campo.mobs.values()].map((e) => `${e.slot}:${e.cx},${e.cy}`).sort().join('|');
  ok(devolta === noComeco, 'voltar ao zero devolve exatamente a cena inicial');
  ok(p.campo.mobs.size === rep.atores.length, 'quem tinha morrido volta ao mapa', `${p.campo.mobs.size}`);
  ok(p.feed.length === 0, 'o feed de abates também volta ao zero');

  // Troca de pokémon: voltar tem de trazer o TITULAR de volta, não deixar o reserva no slot.
  const trocado = rep.quadros.flatMap((q) => q.c ?? [])[0];
  if (trocado) {
    const base = rep.atores.find((a) => a.s === trocado.s);
    ok(p.campo.mobs.get(trocado.s).nome === base.n, 'o slot volta com o pokémon titular');
  } else {
    ok(true, 'nenhuma troca nesta guerra — nada a reverter');
  }
  p.destruir();
}

secao('Um ponto qualquer da fita é reproduzível');
{
  const meio = Math.floor(rep.dur / 2);
  const direto = novoPlayer();
  direto.irPara(meio);

  const passandoPorTudo = novoPlayer();
  for (const marca of [meio / 4, meio / 2, (3 * meio) / 4, meio]) passandoPorTudo.irPara(marca);

  const foto = (p) =>
    [...p.campo.mobs.values()].map((e) => `${e.slot}:${e.cx},${e.cy},${e.hp ?? '-'}`).sort().join('|');
  ok(foto(direto) === foto(passandoPorTudo), 'chegar de uma vez ou aos poucos dá a mesma cena');

  const s = direto.instantaneo();
  ok(s.t === meio, 'o relógio para onde foi pedido');
  ok(s.guilds.every((g) => g.vivos <= g.total), 'ninguém revive no meio da fita');
  direto.destruir();
  passandoPorTudo.destruir();
}

secao('A câmera nunca fica olhando para um cadáver');
{
  const p = novoPlayer();
  let orfa = 0;
  for (let tv = 0; tv <= rep.dur; tv += 2000) {
    p.irPara(tv);
    const foco = p.focoSlot;
    // Só vale enquanto ainda houver alguém de pé — no fim da fita todos podem estar fora.
    const algumVivo = [...p.base.values()].some((a) => !a.tr && !p.estado.get(a.s)?.fora);
    if (algumVivo && (foco == null || p.estado.get(foco)?.fora)) orfa++;
  }
  ok(!orfa, 'a câmera troca de dono quando o acompanhado cai', `${orfa} instantes órfãos`);

  const escolhido = p.lutadores().find((l) => l.vivo) ?? p.lutadores()[0];
  p.seguir(escolhido.slot, true);
  ok(p.auto === false, 'escolher um lutador na mão desliga a câmera automática');
  ok(p.campo.foco === p.campo.mobs.get(escolhido.slot), 'o renderizador passa a seguir o escolhido');
  p.destruir();
}

// ------------------------------------------------------------------ os golpes
//
// A fita carrega `a` (`[atacante, alvo, iGolpe, dano, ef100, stab]`) e o player devolve isso
// ao MESMO `golpe()` da hunt. Aqui não há tela, então o que se confere é a CHAMADA: que ela
// nomeia as duas entidades certas, que a busca não despeja meia guerra de efeitos de uma vez
// e que o modo otimizado cala tudo.

/** Troca `golpeEntreSlots` por um espião e devolve a lista do que foi pedido. */
function espionarGolpes(p) {
  const vistos = [];
  const real = p.campo.golpeEntreSlots.bind(p.campo);
  p.campo.golpeEntreSlots = (arg) => {
    vistos.push(arg);
    return real(arg);
  };
  return vistos;
}

secao('Os golpes viram animação');
{
  const totalGravado = (rep.quadros ?? []).reduce((n, q) => n + (q.a?.length ?? 0) / 6, 0);
  ok(totalGravado > 0, 'a gravação tem golpes', `${totalGravado}`);
  ok((rep.golpes ?? []).length > 0, 'e a tabela de golpes do cabeçalho', `${rep.golpes?.length}`);
  ok(
    (rep.golpes ?? []).every((g) => g && typeof g.n === 'string' && typeof g.t === 'string'),
    'cada entrada da tabela tem nome e tipo',
  );

  const p = novoPlayer();
  const vistos = espionarGolpes(p);
  p.tocar();
  // A fita inteira, em pedaços — é o caminho do playback (`deUmaVez` falso).
  for (let tv = 0; tv <= rep.dur; tv += 250) p.aplicarAte(tv, false);

  ok(vistos.length === totalGravado, 'toca um golpe para cada pancada gravada', `${vistos.length} de ${totalGravado}`);
  ok(
    vistos.every((g) => p.base.has(g.de) && p.base.has(g.para) && g.de !== g.para),
    'atacante e alvo são slots de verdade, e nunca o mesmo',
  );
  ok(
    vistos.every((g) => typeof g.tipo === 'string' && g.tipo && typeof g.golpe === 'string' && g.golpe),
    'todo golpe chega com nome e tipo (é o que escolhe o efeito na tela)',
  );
  ok(vistos.every((g) => g.dano > 0 && Number.isFinite(g.ef)), 'e com dano e efetividade');
  // O que o campo FEZ com isso. Os dois são síncronos (o efeito de tipo não é: ele espera um
  // PNG que não existe no teste), e são o contraste que dá sentido ao modo otimizado abaixo.
  ok(p.campo.flutuantes.length > 0, 'o campo encheu a fila de números de dano', `${p.campo.flutuantes.length}`);
  ok(
    [...p.campo.mobs.values()].some((e) => e.investida > 0),
    'e alguém está no meio do pulinho da investida',
  );
  p.destruir();
}

secao('A busca não despeja a guerra inteira na tela');
{
  const p = novoPlayer();
  const vistos = espionarGolpes(p);
  p.irPara(rep.dur);
  ok(vistos.length === 0, 'pular para o fim não toca golpe nenhum', `tocou ${vistos.length}`);
  p.destruir();
}

secao('Golpe fora da tela não é desenhado');
{
  const p = novoPlayer();
  const vistos = espionarGolpes(p);
  // A janela da câmera é recalculada a cada quadro por `Campo.quadro`, e aqui não há laço de
  // animação nenhum — então dá para plantá-la à mão. Esta fica no canto oposto da arena, a
  // dez mil px de qualquer lutador: nenhuma pancada da guerra cabe dentro dela.
  p.campo.vista = { x0: -20000, y0: -20000, x1: -19000, y1: -19000 };
  p.tocar();
  for (let tv = 0; tv <= rep.dur; tv += 250) p.aplicarAte(tv, false);

  ok(vistos.length > 0, 'o player entrega os golpes ao campo como sempre');
  ok(p.campo.flutuantes.length === 0, 'e nenhum número de dano é criado', `${p.campo.flutuantes.length}`);
  ok(p.campo.efeitos.length === 0, 'nem efeito de tipo', `${p.campo.efeitos.length}`);
  p.destruir();
}

secao('Modo otimizado cala as animações');
{
  const p = novoPlayer();
  const vistos = espionarGolpes(p);
  prefs.set('cfg-otimizado', '1');
  p.tocar();
  for (let tv = 0; tv <= rep.dur; tv += 250) p.aplicarAte(tv, false);
  // O player CHAMA (ele não conhece a preferência); quem recusa é o campo, na primeira linha
  // de `golpeEntreSlots` — e é por isso que a prova é o efeito não ter entrado na fila.
  ok(vistos.length > 0, 'o player continua entregando os golpes ao campo');
  ok(p.campo.flutuantes.length === 0, 'e nenhum número de dano entra na fila', `${p.campo.flutuantes.length}`);
  ok(
    [...p.campo.mobs.values()].every((e) => !(e.investida > 0)),
    'nem o pulinho da investida',
  );
  prefs.delete('cfg-otimizado');
  p.destruir();
}

secao('Ciclo de vida');
{
  const p = novoPlayer();
  p.destruir();
  ok(p.vivo === false && p.campo.vivo === false, 'destruir para o player e o renderizador');
  ok(p.campo.mobs.size === 0, 'e solta a cena da memória');
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
