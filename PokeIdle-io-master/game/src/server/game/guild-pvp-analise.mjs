// A ANÁLISE DA GUERRA — os números de cada jogador, tirados da própria fita.
//
// ### Por que sai do replay, e não de um contador novo no simulador
//
// A fita (`guild-pvp-sim.mjs`, ver `novoGravador`) já guarda TODA pancada da guerra: quem bateu,
// em quem, com qual golpe, quanto de dano, a efetividade e o STAB — é o que o player precisa
// para desenhar a investida e o número voando. Guarda também toda troca de pokémon (`c`) e quem
// saiu do mapa (`m`). Com isso dá para reconstruir, golpe a golpe, o dano causado e recebido de
// cada jogador e de cada pokémon, os abates e a ordem em que os times entraram em campo.
//
// Tirar daqui em vez de acrescentar contadores ao simulador tem duas vantagens que decidiram:
//
//   · vale para a guerra que JÁ aconteceu — a análise existe desde a primeira fita gravada, e
//     não só da próxima guerra em diante;
//   · o simulador continua sem saber que a análise existe. Nenhum número dela entra na conta da
//     batalha, então um erro aqui erra a TELA, nunca o resultado.
//
// ### O dano é o EFETIVO
//
// O `dano` gravado em `a` é o da fórmula, e o golpe que mata costuma passar do HP que sobrava
// (400 de dano num alvo com 30). Somar o bruto inflaria justamente quem dá o último golpe. Aqui
// o HP de cada slot é acompanhado e o total soma só o que o alvo de fato perdeu. O MAIOR GOLPE,
// em compensação, usa o bruto: ali a pergunta é "qual foi a pancada mais forte", e cortar pelo
// HP do alvo premiaria quem bateu num bicho cheio.
//
// ### Como a troca de pokémon é casada com o golpe que a causou
//
// Dentro de um quadro as listas vêm separadas (`a`, `c`…), mas na simulação elas nascem na mesma
// ordem: um golpe que zera o alvo empurra, na hora, a troca daquele slot. Então, percorrendo `a`
// na ordem, quando o HP acompanhado de um slot chega a zero a PRÓXIMA troca daquele slot naquele
// quadro é a do pokémon seguinte. Se não houver troca, o membro caiu de vez.
//
// Assistência não entra: a fita não guarda quem tocou num alvo antes do abate de um jeito que
// distinga ajuda de coincidência, e inventar a regra seria mostrar um número que não existe.

/** Quantos golpes e espécies a análise lista nos "mais usados". */
const TOP_LISTA = 8;

const novoPokemon = (a, t = 0) => ({
  n: a.n ?? '?',
  // A ESPÉCIE (`pokeId`). Só existe nas fitas gravadas a partir do Tracker; nas antigas vem 0,
  // e quem agrega por espécie simplesmente ignora essas entradas (ver `fichaDaPartida`).
  e: Number(a.e) || 0,
  lt: Number(a.lt) || 0,
  nv: Number(a.nv) || 1,
  sh: a.sh ? 1 : 0,
  mhp: Math.max(1, Number(a.mhp) || 1),
  d: 0, // dano causado (efetivo)
  r: 0, // dano recebido
  k: 0, // abates
  gl: 0, // golpes dados
  caiu: 0,
  em: t, // quando entrou em campo (ms da fita)
  ate: null, // quando caiu (ms da fita)
});

/**
 * A análise inteira de uma guerra.
 *
 * @param replay a fita gravada (`guild_pvp_batalhas.replay`)
 * @param resumo o placar do dia (`guild_pvp_batalhas.resumo`) — dá GP e colocação
 * @returns o pacote que o cliente desenha, ou `null` sem fita
 */
export function analisarGuerra(replay, resumo = {}, { golpesPorLado = false } = {}) {
  if (!replay || !Array.isArray(replay.atores) || !Array.isArray(replay.quadros)) return null;

  const guildsRep = Array.isArray(replay.guilds) ? replay.guilds : [];
  const golpesTab = Array.isArray(replay.golpes) ? replay.golpes : [];

  // ---- quem é cada slot
  /** slot do POKÉMON → o membro (um por jogador na guerra) */
  const porSlot = new Map();
  /** nick → membro */
  const membros = [];
  for (const a of replay.atores) {
    if (!a || a.tr) continue; // treinador não bate nem apanha
    const m = {
      nick: String(a.dono ?? '?'),
      g: Number(a.g) || 0,
      d: 0,
      r: 0,
      k: 0,
      mo: 0, // pokémon que ele perdeu
      gl: 0,
      sup: 0, // golpes super efetivos
      maior: null, // { v, gi, alvo, pk }
      caiuEm: null,
      pks: [novoPokemon(a)],
      hp: Math.max(0, Number(a.hp ?? a.mhp) || 0),
    };
    porSlot.set(Number(a.s), m);
    membros.push(m);
  }
  if (!membros.length) return null;

  const usoGolpe = new Map(); // índice do golpe → { usos, d }
  // O mesmo, separado por LADO (`g`), e só quando quem chamou pediu. É o que a ficha de uma
  // partida de PvP precisa ("os golpes que MAIS me renderam"), e é o que uma guerra de 50
  // guilds não pode pagar: lá seriam 50 listas para uma tela que mostra uma só.
  const usoGolpeLado = golpesPorLado ? new Map() : null; // `${g}|${gi}` → { g, gi, usos, d }
  const abatesLinha = []; // [{ t, a, apk, v, vpk }] — em ordem de tempo
  let golpesTotal = 0;
  let danoTotal = 0;
  const semGolpes = !!replay.golpesCortados || !replay.quadros.some((q) => q?.a?.length);

  for (const q of replay.quadros) {
    if (!q) continue;
    const t = Number(q.t) || 0;
    // As trocas deste quadro, por slot, na ordem em que aconteceram.
    const trocas = new Map();
    for (const c of q.c ?? []) {
      const s = Number(c?.s);
      if (!trocas.has(s)) trocas.set(s, []);
      trocas.get(s).push(c);
    }
    const a = Array.isArray(q.a) ? q.a : [];
    for (let i = 0; i + 5 < a.length; i += 6) {
      const atk = porSlot.get(Number(a[i]));
      const alvo = porSlot.get(Number(a[i + 1]));
      if (!atk || !alvo) continue;
      const gi = Number(a[i + 2]) || 0;
      const bruto = Math.max(0, Number(a[i + 3]) || 0);
      const ef100 = Number(a[i + 4]) || 100;
      const efetivo = Math.min(bruto, Math.max(0, alvo.hp));
      alvo.hp -= efetivo;

      const pkAtk = atk.pks[atk.pks.length - 1];
      const pkAlvo = alvo.pks[alvo.pks.length - 1];
      atk.d += efetivo;
      atk.gl++;
      pkAtk.d += efetivo;
      pkAtk.gl++;
      if (ef100 > 100) atk.sup++;
      alvo.r += efetivo;
      pkAlvo.r += efetivo;
      golpesTotal++;
      danoTotal += efetivo;

      const uso = usoGolpe.get(gi) ?? { usos: 0, d: 0 };
      uso.usos++;
      uso.d += efetivo;
      usoGolpe.set(gi, uso);

      if (usoGolpeLado) {
        const chave = `${atk.g}|${gi}`;
        const u2 = usoGolpeLado.get(chave) ?? { g: atk.g, gi, usos: 0, d: 0 };
        u2.usos++;
        u2.d += efetivo;
        usoGolpeLado.set(chave, u2);
      }

      if (!atk.maior || bruto > atk.maior.v) {
        atk.maior = { v: bruto, gi, alvo: alvo.nick, pk: pkAtk.n, ef: ef100 };
      }

      if (alvo.hp > 0) continue;

      // ---- abate
      atk.k++;
      pkAtk.k++;
      alvo.mo++;
      pkAlvo.caiu = 1;
      pkAlvo.ate = t;
      abatesLinha.push({ t, a: atk.nick, apk: pkAtk.n, v: alvo.nick, vpk: pkAlvo.n });

      const fila = trocas.get(Number(a[i + 1]));
      const prox = fila?.shift();
      if (prox) {
        alvo.pks.push(novoPokemon(prox, t));
        alvo.hp = Math.max(0, Number(prox.hp ?? prox.mhp) || 0);
      } else {
        alvo.caiuEm = t;
      }
    }
  }

  // ---- as guilds, na ordem do placar
  const placar = Array.isArray(resumo?.placar) ? resumo.placar : [];
  const guilds = guildsRep.map((g, i) => {
    const doPlacar = placar.find((p) => p.id === g?.id) ?? {};
    const meus = membros.filter((m) => m.g === i);
    const mvp = meus.reduce((melhor, m) => (!melhor || m.d > melhor.d ? m : melhor), null);
    return {
      i,
      id: g?.id ?? null,
      nome: g?.nome ?? doPlacar.nome ?? '?',
      brasao: g?.brasao ?? doPlacar.brasao ?? null,
      pos: Number(doPlacar.pos) || guildsRep.length,
      gp: Number(doPlacar.gp) || 0,
      k: soma(meus, 'k'),
      mo: soma(meus, 'mo'),
      d: soma(meus, 'd'),
      r: soma(meus, 'r'),
      n: meus.length,
      vivos: meus.filter((m) => m.caiuEm == null).length,
      mvp: mvp && mvp.d > 0 ? mvp.nick : null,
    };
  }).sort((x, y) => x.pos - y.pos);

  // ---- os destaques da guerra inteira
  const topo = (campo) => membros.reduce((melhor, m) => (!melhor || m[campo] > melhor[campo] ? m : melhor), null);
  const maiorDano = topo('d');
  const maisAbates = topo('k');
  const muralha = topo('r');
  const maisSuper = topo('sup');
  let maiorGolpe = null;
  let melhorPk = null;
  for (const m of membros) {
    if (m.maior && (!maiorGolpe || m.maior.v > maiorGolpe.v)) maiorGolpe = { ...m.maior, nick: m.nick, g: m.g };
    for (const pk of m.pks) {
      if (!melhorPk || pk.d > melhorPk.d) melhorPk = { ...pk, nick: m.nick, g: m.g };
    }
  }
  // O SOBREVIVENTE: quem ficou mais tempo de pé. Quem não caiu empata no fim da fita, e aí
  // desempata quem causou mais dano — ficar parado num canto não é o que o título quer dizer.
  const dur = Number(replay.dur) || Number(resumo?.duracaoMs) || 0;
  const sobrevivente = [...membros].sort(
    (x, y) => (y.caiuEm ?? dur + 1) - (x.caiuEm ?? dur + 1) || y.d - x.d,
  )[0];

  const golpeNome = (gi) => golpesTab[gi] ?? { n: '?', t: null };

  // As espécies que mais entraram em campo (contando cada entrada) e o dano que causaram.
  const porEspecie = new Map();
  for (const m of membros) {
    for (const pk of m.pks) {
      const chave = `${pk.n}|${pk.sh}`;
      const e = porEspecie.get(chave) ?? { n: pk.n, lt: pk.lt, sh: pk.sh, usos: 0, d: 0, k: 0 };
      e.usos++;
      e.d += pk.d;
      e.k += pk.k;
      porEspecie.set(chave, e);
    }
  }

  return {
    v: 1,
    dia: resumo?.dia ?? null,
    motivo: resumo?.motivo ?? null,
    dur,
    semGolpes,
    totais: {
      guilds: guildsRep.length,
      lutadores: membros.length,
      golpes: golpesTotal,
      dano: danoTotal,
      abates: abatesLinha.length,
      pokemons: membros.reduce((s, m) => s + m.pks.length, 0),
    },
    guilds,
    jogadores: membros
      .map((m) => ({
        nick: m.nick,
        g: m.g,
        gid: guildsRep[m.g]?.id ?? null,
        d: m.d,
        r: m.r,
        k: m.k,
        mo: m.mo,
        gl: m.gl,
        sup: m.sup,
        vivo: m.caiuEm == null ? 1 : 0,
        caiuEm: m.caiuEm,
        maior: m.maior ? { v: m.maior.v, golpe: golpeNome(m.maior.gi).n, tipo: golpeNome(m.maior.gi).t, alvo: m.maior.alvo, pk: m.maior.pk } : null,
        pks: m.pks,
      }))
      .sort((x, y) => y.d - x.d || y.k - x.k || x.nick.localeCompare(y.nick)),
    destaques: {
      dano: maiorDano && maiorDano.d > 0 ? { nick: maiorDano.nick, g: maiorDano.g, v: maiorDano.d } : null,
      abates: maisAbates && maisAbates.k > 0 ? { nick: maisAbates.nick, g: maisAbates.g, v: maisAbates.k } : null,
      muralha: muralha && muralha.r > 0 ? { nick: muralha.nick, g: muralha.g, v: muralha.r } : null,
      superEfetivo: maisSuper && maisSuper.sup > 0 ? { nick: maisSuper.nick, g: maisSuper.g, v: maisSuper.sup } : null,
      maiorGolpe: maiorGolpe
        ? { nick: maiorGolpe.nick, g: maiorGolpe.g, v: maiorGolpe.v, golpe: golpeNome(maiorGolpe.gi).n, tipo: golpeNome(maiorGolpe.gi).t, pk: maiorGolpe.pk, alvo: maiorGolpe.alvo }
        : null,
      pokemon: melhorPk && melhorPk.d > 0
        ? { nick: melhorPk.nick, g: melhorPk.g, n: melhorPk.n, lt: melhorPk.lt, sh: melhorPk.sh, nv: melhorPk.nv, v: melhorPk.d, k: melhorPk.k }
        : null,
      primeiroSangue: abatesLinha[0] ?? null,
      sobrevivente: sobrevivente
        ? { nick: sobrevivente.nick, g: sobrevivente.g, vivo: sobrevivente.caiuEm == null ? 1 : 0, ate: sobrevivente.caiuEm ?? dur }
        : null,
    },
    golpes: [...usoGolpe.entries()]
      .map(([gi, u]) => ({ n: golpeNome(gi).n, t: golpeNome(gi).t, usos: u.usos, d: u.d }))
      .sort((x, y) => y.d - x.d)
      .slice(0, TOP_LISTA),
    ...(usoGolpeLado
      ? {
          golpesPorLado: [...usoGolpeLado.values()]
            .map((u) => ({ g: u.g, n: golpeNome(u.gi).n, t: golpeNome(u.gi).t, usos: u.usos, d: u.d }))
            .sort((x, y) => y.d - x.d),
        }
      : {}),
    especies: [...porEspecie.values()].sort((x, y) => y.d - x.d || y.usos - x.usos).slice(0, TOP_LISTA),
    // Os últimos abates da guerra — o fim da briga, que é o que decide a colocação.
    abatesFinais: abatesLinha.slice(-6),
  };
}

const soma = (lista, campo) => lista.reduce((s, x) => s + (Number(x[campo]) || 0), 0);
