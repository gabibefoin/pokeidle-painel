// O fluxo do CENTRO POKÉMON, contra o servidor no ar.
//
// Três regras que já foram diferentes e agora são estas:
//
//   1. a caixa da enfermeira só anuncia NOCAUTE quando o time caiu de verdade. Sair vivo da
//      arena PvP (ou ir ao Centro a pé) é `visita`, não `morte`;
//   2. curar NÃO teleporta de volta para a hunt anterior — o jogador fica no Centro e escolhe
//      no Mapa para onde ir;
//   3. quem tira do Centro é entrar numa área.
//
// E a PRAÇA, que é o Centro de hoje: dois clientes de verdade entram, andam com o teclado, se
// veem, veem o pokémon de batalha um do outro e somem da cena do outro ao sair. É a única
// parte do jogo, junto da arena PvP, em que um jogador aparece na tela de outro — e a única
// em que o movimento vem do teclado, então os testes de "andou" e "não atravessa parede"
// valem por toda a lógica do `centro.mjs`.
//
// Precisa do servidor de pé:  npm run infra && npm start
//   node tools/teste-centro-fluxo.mjs
import { WebSocket } from 'ws';
import { helloCom, sessaoPara } from './auth-teste.mjs';
import { criarMescladorDeEstado } from '../src/shared/estado-delta.mjs';

const URL = process.env.URL ?? 'ws://localhost:8080';
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

/**
 * Um cliente com a MESMA leitura de campo que o browser faz.
 *
 * O `campo.init` traz a cena inteira e as mensagens `campo` só o que mudou, então quem quer
 * saber onde alguém está precisa mesclar uma na outra — exatamente como `campo.mjs` faz na
 * tela. Sem isso o teste não conseguiria afirmar nada sobre movimento.
 */
function cliente(nick) {
  const c = {
    nick,
    ws: new WebSocket(URL),
    estado: null,
    welcome: null,
    eventos: [],
    cena: null, // último campo.init
    heroi: null, // o boneco do próprio jogador, na praça
    mobs: new Map(), // slot -> entidade (os outros treinadores, os pokémon e os NPCs)
  };

  const mesclar = (alvo, b) => {
    const e = alvo ?? {};
    if (b.c !== undefined) e.cx = b.c;
    if (b.r !== undefined) e.cy = b.r;
    if (b.n !== undefined) e.nome = b.n;
    if (b.lt !== undefined) e.looktype = b.lt;
    if (b.nv !== undefined) e.level = b.nv;
    if (b.tr !== undefined) e.ehTreinador = !!b.tr;
    return e;
  };

  const mesclarEstado = criarMescladorDeEstado();

  const aplicarCampo = (m) => {
    if (m.heroi) c.heroi = mesclar(c.heroi, m.heroi);
    for (const b of m.mobs ?? []) c.mobs.set(b.s, mesclar(c.mobs.get(b.s), b));
    for (const s of m.fora ?? []) c.mobs.delete(s);
  };

  c.pronto = new Promise((resolve) => {
    c.ws.on('open', async () => {
      try {
        const sessao = await sessaoPara(nick);
        c.ws.send(JSON.stringify(helloCom(sessao)));
      } catch (err) {
        console.error(`auth ${nick}:`, err.message);
      }
    });
    c.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') {
        c.welcome = m;
        c.estado = mesclarEstado(m.estado);
        resolve();
      } else if (m.t === 'estado') c.estado = mesclarEstado(m.estado);
      else if (m.t === 'batalha') c.eventos.push(...m.ev);
      else if (m.t === 'campo.init') {
        c.cena = m;
        c.heroi = null;
        c.mobs.clear();
        aplicarCampo(m);
      } else if (m.t === 'campo') aplicarCampo(m);
    });
  });
  c.enviar = (o) => c.ws.send(JSON.stringify(o));
  c.ev = (k) => c.eventos.filter((e) => e.k === k);
  /** A entidade de outro jogador (ou do pokémon dele) pelo nome escrito em cima. */
  c.porNome = (nome) => [...c.mobs.values()].find((e) => e.nome === nome) ?? null;
  return c;
}
async function ate(cond, ms = 15000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (cond()) return true;
    await dormir(120);
  }
  return false;
}

console.log(`CENTRO POKÉMON — fluxo (${URL})\n${'='.repeat(46)}`);

const a = cliente(`ctr${Math.floor(Math.random() * 90000 + 1000)}`);
await a.pronto;
// O personagem vem ANTES do pokémon: o servidor recusa `starter.pick` de quem ainda não
// fechou o visual (ver o onboarding em `sim.mjs`). `visual: {}` cai nas cores padrão.
if (a.welcome.starters?.length) {
  a.enviar({ t: 'visual.set', genero: 'male', visual: {} });
  a.enviar({ t: 'starter.pick', speciesId: 4 });
}
await ate(() => a.estado.pokemons.length);

// Uma hunt de nível 1, que um treinador recém-criado consegue entrar.
const hunt = a.welcome.hunts.find((h) => h.nivel <= 1);

secao('Todo login começa no Centro Pokémon');
ok(a.estado.noCentro === true, 'o treinador nasce na praça, não numa hunt');

secao('Ir ao Centro a pé (visita)');
a.enviar({ t: 'hunt.select', slug: hunt.slug });
ok(await ate(() => a.estado.huntSlug === hunt.slug), `entra na hunt ${hunt.slug}`);
ok(!a.estado.noCentro, 'e NÃO está no Centro');

// Apanhar um pouco antes de subir ao Centro. Sem isto o teste era refém da sorte: com o time
// intacto a enfermeira não tem o que curar, e as afirmações sobre a cura passavam ou falhavam
// conforme o selvagem tivesse acertado um golpe naqueles dois segundos.
const ferido = () => {
  const k = a.estado.pokemons.find((x) => x.id === a.estado.activeId);
  return k && k.hp < k.maxHp;
};
ok(await ate(ferido, 30000), 'o pokémon leva dano na hunt (é o que dá o que curar)');

// Acabou de trocar dano: a subida ao Centro fica travada por 3 s. É a trava que impede sumir
// do combate no frame do golpe fatal — a mesma ideia dos 10 s da arena, num número menor.
{
  const antes = a.ev('aviso').length;
  a.enviar({ t: 'centro.ir' });
  const recusou = await ate(() => a.ev('aviso').length > antes, 2500);
  if (recusou) {
    ok(/combate/i.test(a.ev('aviso').at(-1)?.msg ?? ''), 'em combate, centro.ir é RECUSADO', a.ev('aviso').at(-1)?.msg);
    ok(!a.estado.noCentro, 'e o treinador continua na hunt');
  } else {
    // O selvagem pode ter morrido no meio: aí já se passaram os 3 s e a subida é legítima.
    ok(a.estado.noCentro, 'fora de combate, centro.ir é aceito');
  }
}

// Fora de combate a subida acontece. Tenta de novo até a janela de 3 s abrir — que é o que o
// jogador faz olhando a contagem no botão.
for (let i = 0; i < 20 && !a.estado.noCentro; i++) {
  a.enviar({ t: 'centro.ir' });
  await dormir(1500);
}
ok(await ate(() => a.estado.noCentro), 'o botão do palco leva ao Centro');
ok(a.estado.centroMotivo === 'visita', 'o motivo é VISITA, não morte', a.estado.centroMotivo);
ok(a.estado.huntSlug === hunt.slug, 'a hunt fica guardada para o Mapa mostrar');

secao('A enfermeira responde');
ok(a.ev('joy').some((e) => e.fala === 'ola'), 'ela recebe quem chega a pé com um "olá"');

secao('Curar mantém o jogador no Centro');
a.enviar({ t: 'centro.curar' });
ok(await ate(() => a.ev('curado').length), 'a enfermeira cura');
await dormir(900);
ok(a.estado.noCentro === true, 'e o jogador CONTINUA no Centro (sem teleporte)', `noCentro=${a.estado.noCentro}`);
ok(a.estado.centroMotivo === 'curado', 'o motivo passa a ser "curado"', a.estado.centroMotivo);
ok(
  a.estado.pokemons.filter((k) => k.slot != null).every((k) => k.hp === k.maxHp),
  'o time está com HP cheio',
);
ok(a.ev('joy').some((e) => e.fala === 'curou'), 'e ela avisa que terminou');

// Clicar no botão com o time inteiro de pé não pode sair calado: é o clique mais comum de
// todos (o jogador passa e clica), e um botão mudo parece um botão quebrado.
{
  const antes = a.ev('joy').length;
  a.enviar({ t: 'centro.curar' });
  ok(
    await ate(() => a.ev('joy').length > antes, 4000),
    'clicar com o time já cheio faz a Joy responder em vez de nada acontecer',
  );
  ok(a.ev('joy').at(-1)?.fala === 'jaCurado', 'e a resposta é a da casa cheia', a.ev('joy').at(-1)?.fala);
}

// ─────────────────────────────────────────────────────────────── a praça
//
// Daqui para baixo é a área social: andar, se ver, e sumir da cena do outro ao sair.

secao('A praça: a cena é uma área andável de verdade');
ok(a.cena?.centro === true, 'o campo.init vem marcado como Centro');
ok(a.cena?.slug === 'centro', 'o slug é a área especial "centro"', String(a.cena?.slug));
ok(a.cena?.mapa === 'cerulean', 'e os tiles vêm do mapa de Cerulean', String(a.cena?.mapa));
ok(a.cena?.box?.[2] > 40 && a.cena?.box?.[3] > 30, 'a caixa é a praça inteira, não um recorte de 19×19', JSON.stringify(a.cena?.box));
ok(a.heroi != null, 'o herói da cena é o BONECO do jogador (a câmera segue quem anda)');
ok(!a.cena?.treinador, 'e não vem um segundo treinador junto', JSON.stringify(a.cena?.treinador));
ok(!!a.porNome('Enfermeira Joy'), 'a Enfermeira Joy está na praça');
ok(!!a.porNome('Chansey'), 'a Chansey também');
ok(!!a.porNome('TM Researcher'), 'o TM Researcher está na sala TR');

secao('Andar com o teclado');
{
  const antes = { ...a.heroi };
  a.enviar({ t: 'centro.andar', dir: 2 }); // leste
  const andou = await ate(() => a.heroi.cx > antes.cx, 3000);
  ok(andou, 'segurar a direção move o boneco', `${antes.cx},${antes.cy} → ${a.heroi.cx},${a.heroi.cy}`);
  ok(a.heroi.cy === antes.cy, 'e só no eixo pedido');

  a.enviar({ t: 'centro.andar', dir: 0 });
  await dormir(600);
  const parou = { ...a.heroi };
  await dormir(600);
  ok(a.heroi.cx === parou.cx && a.heroi.cy === parou.cy, 'soltar a tecla para o boneco');
}

secao('Ninguém sai do mapa');
{
  // Segura o norte até o boneco encostar em alguma coisa. A praça é fechada em toda volta,
  // então isso TEM que acontecer — e a posição final tem que continuar dentro da grade.
  a.enviar({ t: 'centro.andar', dir: 1 });
  const limite = Date.now() + 8000;
  let ultima = `${a.heroi.cx},${a.heroi.cy}`;
  let desde = Date.now();
  let parou = false;
  while (Date.now() < limite) {
    await dormir(150);
    const atual = `${a.heroi.cx},${a.heroi.cy}`;
    if (atual !== ultima) {
      ultima = atual;
      desde = Date.now();
    } else if (Date.now() - desde > 700) {
      parou = true;
      break;
    }
  }
  a.enviar({ t: 'centro.andar', dir: 0 });
  ok(parou, 'empurrando o norte, o boneco encosta numa parede e para de andar');

  const [, , cols, rows] = a.cena.box;
  ok(
    a.heroi.cx >= 0 && a.heroi.cx < cols && a.heroi.cy >= 0 && a.heroi.cy < rows,
    'e a posição final continua dentro da grade',
    `${a.heroi.cx},${a.heroi.cy} em ${cols}×${rows}`,
  );
}

secao('Dois jogadores se veem');
const b = cliente(`ctr${Math.floor(Math.random() * 90000 + 1000)}`);
await b.pronto;
if (b.welcome.starters?.length) {
  b.enviar({ t: 'visual.set', genero: 'female', visual: {} });
  b.enviar({ t: 'starter.pick', speciesId: 1 });
}
await ate(() => b.estado.pokemons.length);
{
  b.enviar({ t: 'hunt.select', slug: hunt.slug });
  await ate(() => b.estado.huntSlug === hunt.slug);
  b.enviar({ t: 'centro.ir' });
  ok(await ate(() => b.estado.noCentro), 'o segundo treinador entra na praça');

  ok(await ate(() => !!b.porNome(a.nick), 4000), `${b.nick} vê ${a.nick} na cena`);
  ok(b.porNome(a.nick)?.ehTreinador === true, 'e o boneco vem marcado como treinador (sem barra de vida)');
  ok(await ate(() => !!a.porNome(b.nick), 4000), `e ${a.nick} vê ${b.nick} — os dois estão na mesma sala`);

  // O pokémon de batalha andando atrás do dono.
  //
  // Achá-lo pelo NOME não serve: numa praça com gente, mais alguém tem um Charmander, e o
  // teste passava a seguir o pokémon do vizinho — que está parado, porque o dono dele está
  // parado. O certo é o mais PERTO do boneco de quem interessa, e daí em diante pelo slot.
  const ativo = a.estado.pokemons.find((k) => k.id === a.estado.activeId);
  ok(await ate(() => !!b.porNome(ativo.nome), 4000), `${b.nick} vê o ${ativo.nome} de ${a.nick}`);

  const slotDoPet = (() => {
    const dono = b.porNome(a.nick);
    let melhor = null;
    let melhorD = Infinity;
    for (const [slot, e] of b.mobs) {
      if (e.nome !== ativo.nome || !dono) continue;
      const d = Math.max(Math.abs(e.cx - dono.cx), Math.abs(e.cy - dono.cy));
      if (d < melhorD) {
        melhorD = d;
        melhor = slot;
      }
    }
    return melhor;
  })();
  const pet = () => b.mobs.get(slotDoPet);
  const distancia = (x, y) => (x && y ? Math.max(Math.abs(x.cx - y.cx), Math.abs(x.cy - y.cy)) : Infinity);
  ok(distancia(pet(), b.porNome(a.nick)) <= 2, `o ${ativo.nome} está colado em ${a.nick}`);
  ok(pet()?.ehTreinador !== true, 'o pokémon NÃO é marcado como treinador');

  /**
   * Empurra numa direção e diz se saiu do lugar.
   *
   * O teste anterior deixa o boneco encostado numa parede, e "andar para o sul" nem sempre é
   * possível dali. Tentar as quatro direções tira o teste da mão da sorte: o que ele quer
   * afirmar é que o outro jogador VÊ o movimento, não que o sul estava livre.
   */
  const empurrar = async (dir, ms = 1400) => {
    const antes = `${a.heroi.cx},${a.heroi.cy}`;
    a.enviar({ t: 'centro.andar', dir });
    await dormir(ms);
    a.enviar({ t: 'centro.andar', dir: 0 });
    await dormir(400);
    return `${a.heroi.cx},${a.heroi.cy}` !== antes;
  };

  const pos = { ...b.porNome(a.nick) };
  const petAntes = { ...pet() };
  let andou = false;
  for (const dir of [3, 2, 1, 4]) {
    andou = await empurrar(dir);
    if (andou) break;
  }
  ok(andou, `${a.nick} consegue sair do lugar`);

  const visto = b.porNome(a.nick);
  ok(visto.cx !== pos.cx || visto.cy !== pos.cy, `${b.nick} vê ${a.nick} andar em tempo real`);
  ok(pet().cx !== petAntes.cx || pet().cy !== petAntes.cy, 'e o pokémon vai atrás do dono');
  ok(
    distancia(pet(), visto) <= 2,
    'terminando ao lado dele, não perdido no mapa',
    `dono ${visto.cx},${visto.cy} · pokémon ${pet().cx},${pet().cy}`,
  );
}

// A praça não TEM PvP — ninguém troca dano lá dentro —, mas ela é a porta natural para a
// arena: é onde o time é curado e onde a turma combina a briga. Obrigar a passar pelo Mapa
// antes era uma volta sem propósito nenhum.
secao('Da praça dá para ir direto à arena PvP');
{
  const arenaId = a.welcome.pvpArenas[0].id;
  a.enviar({ t: 'pvp.entrar', arenaId });
  const entrou = await ate(() => a.estado.pvp?.arena != null, 8000);
  ok(entrou, 'entra na arena PvP direto do Centro Pokémon');
  ok(!a.estado.noCentro, 'e deixa de estar no Centro');
  ok(await ate(() => !b.porNome(a.nick), 5000), `o boneco de ${a.nick} some da praça de ${b.nick}`);

  if (entrou) {
    const antes = a.ev('aviso').length;
    a.enviar({ t: 'centro.ir' });
    ok(await ate(() => a.ev('aviso').length > antes, 4000), 'centro.ir é RECUSADO dentro da arena');
    ok(/arena/i.test(a.ev('aviso').at(-1)?.msg ?? ''), 'e manda usar o botão da arena', a.ev('aviso').at(-1)?.msg);
    ok(a.estado.pvp?.arena != null, 'o jogador segue na arena');

    // Sair pela porta certa (com o time de pé) tem de ser VISITA.
    a.enviar({ t: 'pvp.sair' });
    ok(await ate(() => a.estado.noCentro, 8000), 'a saída da arena leva de volta ao Centro');
    ok(
      a.estado.centroMotivo === 'visita',
      'e o motivo é VISITA — o time está inteiro de pé',
      a.estado.centroMotivo,
    );
    ok(await ate(() => !!b.porNome(a.nick), 5000), `e ${b.nick} volta a ver ${a.nick} na praça`);
  }
}

secao('Sair do Centro é escolher área no Mapa');
a.enviar({ t: 'hunt.select', slug: hunt.slug });
ok(await ate(() => !a.estado.noCentro), 'entrar numa área tira do Centro');
ok(a.estado.centroMotivo === null, 'e limpa o motivo', String(a.estado.centroMotivo));
ok(await ate(() => !b.porNome(a.nick), 4000), `e ${a.nick} some da cena de ${b.nick}`);

b.ws.close();
a.ws.close();

// ─────────────────────────────────────── fechar a aba no meio da luta
//
// A regra que fecha o ciclo: como todo login volta ao Centro, sumir do ar precisa custar o
// mesmo que morrer — senão fechar a aba seria a jogada certa em toda luta perdida.

const novoNick = () => `ctr${Math.floor(Math.random() * 90000 + 1000)}`;

async function nascer(nick, speciesId = 4) {
  const c = cliente(nick);
  await c.pronto;
  if (c.welcome.starters?.length) {
    c.enviar({ t: 'visual.set', genero: 'male', visual: {} });
    c.enviar({ t: 'starter.pick', speciesId });
  }
  await ate(() => c.estado.pokemons.length);
  return c;
}

secao('Sumir do ar caçando derruba o time');
{
  const c = await nascer(novoNick());
  c.enviar({ t: 'hunt.select', slug: hunt.slug });
  ok(await ate(() => c.estado.huntSlug === hunt.slug && !c.estado.noCentro), 'entra na hunt');

  c.ws.terminate(); // sem despedida: é o Alt+F4 no meio da caçada
  await dormir(2500);

  const volta = cliente(c.nick);
  await volta.pronto;
  ok(volta.estado.noCentro === true, 'ao voltar, nasce no Centro Pokémon');
  ok(volta.estado.huntSlug === hunt.slug, 'a hunt escolhida continua guardada');
  const equipe = volta.estado.pokemons.filter((k) => k.slot != null);
  ok(equipe.length > 0 && equipe.every((k) => k.hp <= 0), 'com o time no chão — como se tivesse morrido');
  ok(volta.estado.centroMotivo === 'morte', 'e a enfermeira anuncia o nocaute', volta.estado.centroMotivo);
  volta.ws.close();
}

secao('Sumir do ar na arena PvP custa ELO');
{
  const x = await nascer(novoNick(), 4);
  const y = await nascer(novoNick(), 1);
  const arenaId = x.welcome.pvpArenas[0].id;
  x.enviar({ t: 'pvp.entrar', arenaId });
  y.enviar({ t: 'pvp.entrar', arenaId });
  const dentro = await ate(() => x.estado.pvp?.arena && y.estado.pvp?.arena, 8000);
  ok(dentro, 'os dois entram na arena');

  const eloAntes = x.estado.pvp.elo;
  const mortesAntes = x.estado.pvp.mortes;
  x.ws.terminate();
  await dormir(2500);

  const volta = cliente(x.nick);
  await volta.pronto;
  ok(volta.estado.pvp.elo < eloAntes, 'o ELO cai contra a média da sala', `${eloAntes} → ${volta.estado.pvp.elo}`);
  ok(volta.estado.pvp.mortes === mortesAntes + 1, 'a morte é contada');
  ok(volta.estado.pvp.cooldownAte > Date.now(), 'e o cooldown de 5 min está de pé');
  ok(volta.estado.noCentro === true, 'e ele volta no Centro Pokémon');
  volta.ws.close();
  y.ws.close();
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
