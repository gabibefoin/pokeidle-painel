// Smoke test do fluxo completo: conecta, entra numa hunt, liga as automações e
// relata o que aconteceu. Serve para validar balanceamento depois de mexer no combate.
//
//   node tools/smoke.mjs [nick] [slug] [segundos] [starter]
import WebSocket from 'ws';
import { sessaoPara } from './auth-teste.mjs';
import { criarMescladorDeEstado } from '../src/shared/estado-delta.mjs';

const [
  nick = `smoke${Date.now() % 100000}`,
  slug = 'pidgey',
  segundos = 25,
  starter = 'Charmander',
] = process.argv.slice(2);
const url = process.env.WS_URL ?? 'ws://localhost:8080';
const httpUrl = process.env.HTTP_URL ?? 'http://localhost:8080';

async function tokenPara(nickAlvo) {
  const s = await sessaoPara(nickAlvo, { http: httpUrl });
  return s.token;
}

const c = { kills: 0, mortes: 0, bolas: 0, capturas: 0, xp: 0, ouro: 0, drops: 0, levelups: 0 };
const dano = { meu: [], selvagem: [] };
let spawns = 0;
let hunts = [];
let comecou = false;
const mesclar = criarMescladorDeEstado();

const ws = new WebSocket(url);

ws.on('open', async () => {
  try {
    const token = await tokenPara(nick);
    ws.send(JSON.stringify({ t: 'hello', nick, token }));
  } catch (err) {
    console.error('hello falhou:', err.message);
    ws.close();
  }
});

/** Entra na hunt e liga as automações. Só depois que existe um pokémon em campo. */
function comecar(estado) {
  comecou = true;
  const p = estado.pokemons[0];
  console.log(`nick=${estado.nick} · pokémon=${p.nome} nv${p.level} hp${p.maxHp} poder${p.poder} q${p.quality}`);
  console.log(`itens=${JSON.stringify(estado.items)} bolas=${JSON.stringify(estado.balls)}`);
  const h = hunts.find((x) => x.slug === slug) ?? hunts[0];
  console.log(`hunt=${h.slug} nv${h.nivel} espécies=${h.especies.map((e) => e.nome).join(',')}\n`);
  ws.send(JSON.stringify({ t: 'hunt.select', slug: h.slug }));
  ws.send(JSON.stringify({
    t: 'auto.set',
    autoBallSemParar: true,
    autoBallAteCapturar: false,
    ballIds: [1],
    autoRevive: true,
    autoPotion: true,
  }));
}

ws.on('message', (raw) => {
  const m = JSON.parse(raw);

  if (m.t === 'erro') console.log('ERRO:', m.msg);

  if (m.t === 'welcome') {
    // O welcome entra no mesclador ANTES de qualquer desvio. Ele é o quadro completo sobre o
    // qual todo delta seguinte é aplicado; sair daqui sem alimentá-lo (o `return` do starter,
    // logo abaixo) faz o primeiro delta virar a base — e o teste passa a ver um estado sem
    // `nick` nem `balls`, sem nenhum erro. O cliente do jogo mescla no ponto de entrada da
    // mensagem justamente para não ter esse caminho.
    m.estado = mesclar(m.estado);
    hunts = m.hunts;
    // Treinador novo não tem pokémon nenhum até escolher o starter — e não escolhe o starter
    // antes de fechar o personagem, que é a ordem cobrada pelo servidor.
    if (m.starters?.length) {
      const escolha = m.starters.find((s) => s.nome.toLowerCase() === starter.toLowerCase()) ?? m.starters[0];
      console.log(`escolhendo o starter: ${escolha.nome}`);
      ws.send(JSON.stringify({ t: 'visual.set', genero: 'male', visual: {} }));
      ws.send(JSON.stringify({ t: 'starter.pick', speciesId: escolha.speciesId }));
      return; // o resto começa quando o estado voltar com o pokémon
    }
    comecar(m.estado);
  }

  // o estado logo depois do starter.pick é o gatilho para o treinador novo caçar
  if (m.t === 'estado' && !comecou) {
    const e = mesclar(m.estado);
    if (e.pokemons.length) comecar(e);
  }

  if (m.t === 'batalha') {
    for (const e of m.ev) {
      // o servidor recusa área acima do nível do treinador — sem isto o teste ficava mudo
      if (e.k === 'aviso') console.log('AVISO:', e.msg);
      if (e.k === 'spawn') spawns++;
      if (e.k === 'ataque') dano[e.por === 'jogador' ? 'meu' : 'selvagem'].push(e.dano);
      if (e.k === 'morte' && e.quem === 'selvagem') {
        c.kills++;
        c.xp += e.xp;
        c.ouro += e.ouro;
        c.drops += e.drops.length;
      }
      if (e.k === 'morte' && e.quem === 'jogador') c.mortes++;
      if (e.k === 'bola') {
        c.bolas++;
        if (e.sucesso) c.capturas++;
      }
      if (e.k === 'levelup') c.levelups++;
    }
  }
});

ws.on('error', (err) => {
  console.error('falha de conexão:', err.message);
  process.exit(1);
});

const media = (a) => (a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : '—');

setTimeout(() => {
  console.log(`--- ${segundos}s ---`);
  console.log(`spawns=${spawns} kills=${c.kills} capturas=${c.capturas}/${c.bolas} bolas`);
  console.log(`mortes minhas=${c.mortes} levelups=${c.levelups}`);
  console.log(`xp=${c.xp} ouro=${c.ouro} drops=${c.drops}`);
  console.log(`dano médio — meu ${media(dano.meu)} (${dano.meu.length} golpes) · selvagem ${media(dano.selvagem)} (${dano.selvagem.length})`);
  process.exit(0);
}, Number(segundos) * 1000);
