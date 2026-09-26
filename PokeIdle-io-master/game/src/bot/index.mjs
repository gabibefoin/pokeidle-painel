// O BOT DO DISCORD — um processo à parte, na MESMA VPS do jogo e no MESMO Postgres.
//
//     npm run bot
//
// ### O que ele faz, e só
//
// **Convites** (o motivo original de ele existir):
//
//   · vê quem entra no nosso servidor de Discord e por qual link;
//   · credita o ponto ao criador daquele link, se a conta do novato tiver mais de um ano;
//   · escreve a linha no canal de log (quem entrou, por quem, quantos aquele já trouxe);
//   · ao cruzar um marco, gera um código único e manda no privado do padrinho.
//
// **Radares** (ver `radar.mjs`) — o bot LENDO o banco do jogo e contando no Discord:
//
//   · captura de shiny → ✨┃radar-shiny;
//   · saque aprovado e depósito confirmado → 🤑┃radar-depositos-saques;
//   · saque PEDIDO → canal da staff, mencionando o cargo que aprova.
//
// Os radares começam a contar do instante em que sobem: nada de histórico. Ver
// `semearCursores` em `radar-db.mjs`.
//
// Quem ENTREGA o prêmio é o jogo, quando o jogador digita `/resgatar <codigo>` no chat. O bot
// não toca em nada do jogador — ele escreve em `convite_membros` e `convite_codigos`, e para.
// É de propósito: um bot que somasse diamante direto na conta seria um segundo dono do estado
// do jogador, e o write-behind do sim passaria por cima dele no ciclo seguinte.
//
// ### Por que um processo separado, e não dentro do sim
//
// O sim é shardado (dez processos), e o Gateway do Discord é UMA conexão. Subir o bot dentro do
// sim daria dez bots no mesmo servidor, cada um contando a mesma entrada. Fora dele, é um
// `systemd` de uma linha e a conta é feita uma vez.
//
// ### Configuração (no `.env` do jogo)
//
//     DISCORD_BOT_TOKEN=...      Developer Portal → Bot → Reset Token
//     DISCORD_GUILD_ID=...       id do nosso servidor (clique direito → Copiar ID do servidor)
//     DISCORD_CANAL_CONVITES=... id do canal onde as entradas são anunciadas
//
// Os canais dos radares têm PADRÃO no código (são os do nosso servidor, e id de canal não é
// segredo) — só é preciso mexer no `.env` para apontá-los para outro lugar ou para desligar um
// deles com a variável vazia:
//
//     DISCORD_CANAL_RADAR_SHINY=...   ✨┃radar-shiny
//     DISCORD_CANAL_RADAR_GEMAS=...   🤑┃radar-depositos-saques
//     DISCORD_CANAL_SAQUE_STAFF=...   canal da staff, onde cai o pedido de saque
//     DISCORD_CARGO_SAQUE_STAFF=...   cargo mencionado nesse pedido
//     RADAR_MS=10000                  de quanto em quanto tempo ele olha o banco
//
// No Developer Portal, em Bot → Privileged Gateway Intents, **SERVER MEMBERS INTENT** precisa
// estar ligado — sem ele o Discord recusa a conexão (close 4014) e o bot não vê ninguém entrar.
// E o bot precisa da permissão **Gerenciar Servidor** (MANAGE_GUILD) no servidor, senão a
// lista de convites volta 403 e não há atribuição possível.
//
// Faltando qualquer uma das três variáveis, o processo diz o que falta e sai — não fica de pé
// fingindo que funciona.
import '../server/config.mjs';
import { pool } from '../server/db.mjs';
import * as convdb from '../server/convites-db.mjs';
import * as radardb from '../server/radar-db.mjs';
import { INTERVALO_PADRAO_MS, iniciarRadar } from './radar.mjs';
import { conectarGateway, podeEscrever, rest } from './discord.mjs';
import {
  BOTAO_RESGATE, aoClicarNoBotao, aoEntrarMembro, aoSairMembro, explicarSemPermissao,
  garantirPainelDeResgate, recarregarRetrato, reenviarPendentes, semearMembrosExistentes,
  soContando, varrerMarcosAtrasados,
} from './convites.mjs';

const TOKEN = process.env.DISCORD_BOT_TOKEN ?? '';
const GUILD_ID = process.env.DISCORD_GUILD_ID ?? '';
const CANAL_LOG = process.env.DISCORD_CANAL_CONVITES ?? '';
/**
 * O canal do BOTÃO de resgate. Opcional: sem ele, o código sai só pelo privado — que é
 * justamente o caminho que falha para quem tem a DM fechada.
 */
const CANAL_RESGATE = process.env.DISCORD_CANAL_RESGATE ?? '';

/**
 * Os canais e o cargo dos RADARES.
 *
 * Com padrão, e não exigidos como as três de cima: id de canal não é segredo, são os do nosso
 * servidor, e um radar que só funcionasse depois de alguém lembrar de editar o `.env` da VPS
 * subiria mudo sem ninguém perceber. Pôr a variável VAZIA no `.env` desliga aquele radar.
 */
const CANAL_RADAR_SHINY = process.env.DISCORD_CANAL_RADAR_SHINY ?? '1551768376362405919';
const CANAL_RADAR_GEMAS = process.env.DISCORD_CANAL_RADAR_GEMAS ?? '1551768812376825867';
const CANAL_SAQUE_STAFF = process.env.DISCORD_CANAL_SAQUE_STAFF ?? '1538695060529610812';
const CARGO_SAQUE_STAFF = process.env.DISCORD_CARGO_SAQUE_STAFF ?? '1545485031701610497';
const RADAR_MS = Number(process.env.RADAR_MS) || INTERVALO_PADRAO_MS;

/** De quanto em quanto tempo o bot tenta de novo os privados que não saíram. */
const REENVIO_MS = 5 * 60_000;

const faltando = [
  !TOKEN && 'DISCORD_BOT_TOKEN',
  !GUILD_ID && 'DISCORD_GUILD_ID',
  !CANAL_LOG && 'DISCORD_CANAL_CONVITES',
].filter(Boolean);
if (faltando.length) {
  console.error(`[bot] falta configurar no .env: ${faltando.join(', ')}`);
  process.exit(1);
}

await convdb.migrar();
console.log('[bot] tabelas de convite prontas');

// Os radares. A semeadura é o que cumpre o "não precisa pegar o histórico": no primeiro boot
// cada cursor nasce apontando para a última linha que JÁ existe, e o canal só recebe o que
// acontecer daqui para a frente.
await radardb.migrar();
const semeados = await radardb.semearCursores();
if (semeados.length) {
  console.log(`[bot] radar: cursor criado do zero para ${semeados.join(', ')} — sem histórico, como pedido`);
}

// A trava da janela em que o jogo ainda não tem o `/resgatar`. Grita alto e em duas linhas: uma
// variável esquecida aqui é um programa de convites que conta tudo e nunca paga nada.
if (soContando()) {
  console.log('[bot] ===============================================================');
  console.log('[bot] DISCORD_BOT_SO_CONTAR=1 — contando e anunciando, SEM gerar código.');
  console.log('[bot] Tire a variável do .env e reinicie depois que o jogo subir com /resgatar.');
  console.log('[bot] ===============================================================');
}

let gateway = null;
let relogioReenvio = null;

/**
 * O Gateway. Quatro eventos importam:
 *
 *   GUILD_CREATE      chega no boot com o servidor inteiro — é a hora de tirar o primeiro
 *                     retrato dos convites, antes que alguém entre;
 *   GUILD_MEMBER_ADD  alguém entrou;
 *   GUILD_MEMBER_REMOVE  alguém saiu (o ponto dele para de contar);
 *   INVITE_CREATE / INVITE_DELETE  a lista mudou — o retrato precisa acompanhar, senão a
 *                     próxima entrada compara contra uma lista velha.
 */
gateway = conectarGateway(TOKEN, {
  aoPronto: (d) => {
    console.log(`[bot] conectado como ${d.user?.username}#${d.user?.discriminator ?? '0'}`);
  },
  aoEvento: (nome, d) => {
    if (d?.guild_id && String(d.guild_id) !== GUILD_ID) return;

    if (nome === 'GUILD_CREATE') {
      if (String(d.id) !== GUILD_ID) return;
      recarregarRetrato(TOKEN, GUILD_ID)
        .then((n) => console.log(`[bot] ${n} convite(s) no retrato inicial`))
        .catch((err) => {
          console.error('[bot] não deu para ler os convites:', err.message);
          if (err.status === 403) {
            console.error('[bot] o bot precisa da permissão GERENCIAR SERVIDOR para listar convites.');
          }
        });
      // Quem JÁ está no servidor entra na tabela sem padrinho, para um sai-e-volta dele não
      // virar ponto de ninguém. Roda a cada boot, e é idempotente.
      //
      // A varredura dos marcos atrasados vem DEPOIS, encadeada: ela conta os convidados de cada
      // padrinho, e contar antes da semeadura terminar leria uma tabela pela metade.
      // O painel do botão. Vem antes da semeadura de propósito: ele não depende de contagem
      // nenhuma, e ter o canal de pé já no primeiro segundo é melhor do que esperá-la.
      garantirPainelDeResgate({ token: TOKEN, canalId: CANAL_RESGATE })
        .catch((err) => console.error('[bot] não deu para publicar o painel de resgate:', err.message));
      semearMembrosExistentes(TOKEN, GUILD_ID)
        .then(({ vistos, novos }) => {
          console.log(`[bot] ${vistos} membro(s) no servidor — ${novos} semeado(s) sem padrinho`);
          return varrerMarcosAtrasados({ token: TOKEN, canalLogId: CANAL_LOG });
        })
        .then((n) => { if (n) console.log(`[bot] ${n} código(s) atrasado(s) gerados`); })
        .catch((err) => console.error('[bot] não deu para semear os membros:', err.message));
      return;
    }

    if (nome === 'INVITE_CREATE' || nome === 'INVITE_DELETE') {
      recarregarRetrato(TOKEN, GUILD_ID).catch(() => {});
      return;
    }

    if (nome === 'GUILD_MEMBER_ADD') {
      aoEntrarMembro({ token: TOKEN, guildId: GUILD_ID, canalLogId: CANAL_LOG, membro: d })
        .then((r) => {
          if (!r) return;
          const quem = r.padrinho ? `padrinho ${r.padrinho} (${r.convidados})` : 'sem padrinho';
          console.log(`[bot] entrou ${r.membro} — ${quem}`);
          for (const m of r.marcosNovos) console.log(`[bot] marco ${m.marco} → código ${m.codigo}`);
        })
        .catch((err) => console.error('[bot] entrada falhou:', err.message));
      return;
    }

    if (nome === 'GUILD_MEMBER_REMOVE') {
      aoSairMembro({ usuarioId: d.user?.id }).catch(() => {});
      return;
    }

    // O clique no botão "Pegar meu código". `type: 3` é MESSAGE_COMPONENT; o resto das
    // interações (comandos, modais) não existe neste bot.
    //
    // A resposta tem TRÊS SEGUNDOS de prazo, então nada de `await` numa fila aqui: vai direto,
    // com uma consulta de índice no meio.
    if (nome === 'INTERACTION_CREATE' && d?.type === 3 && d?.data?.custom_id === BOTAO_RESGATE) {
      aoClicarNoBotao({ token: TOKEN, interacao: d })
        .catch((err) => console.error('[bot] clique no botão falhou:', err.message));
    }
  },
});

// A varredura dos privados que não saíram. A primeira roda logo, e não daqui a cinco minutos:
// se o processo caiu no meio de uma rajada de marcos, quem está esperando o código espera desde
// antes do restart.
const varrer = () => reenviarPendentes({ token: TOKEN, canalLogId: CANAL_LOG })
  .then((n) => { if (n) console.log(`[bot] ${n} código(s) pendentes reenviados`); })
  .catch((err) => console.error('[bot] varredura de pendentes falhou:', err.message));
varrer();
relogioReenvio = setInterval(varrer, REENVIO_MS);

// Os radares não esperam o Gateway: eles não dependem de evento nenhum do Discord, só do banco
// e da rota REST de mandar mensagem. Subir junto do processo é o certo — um Gateway que demore
// a conectar não pode atrasar o anúncio de um saque.
const radar = iniciarRadar({
  token: TOKEN,
  canalShiny: CANAL_RADAR_SHINY,
  canalGemas: CANAL_RADAR_GEMAS,
  canalSaqueStaff: CANAL_SAQUE_STAFF,
  cargoSaque: CARGO_SAQUE_STAFF,
  intervaloMs: RADAR_MS,
});
console.log(
  `[bot] radar a cada ${Math.round(RADAR_MS / 1000)}s —`
  + ` shiny:${CANAL_RADAR_SHINY || 'off'} gemas:${CANAL_RADAR_GEMAS || 'off'} staff:${CANAL_SAQUE_STAFF || 'off'}`,
);

async function encerrar(sinal) {
  console.log(`[bot] ${sinal} — encerrando`);
  clearInterval(relogioReenvio);
  radar.parar();
  gateway?.fechar();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));

// Uma checagem de sanidade logo no boot: o token responde? O canal existe? E — a que faltava —
// o bot consegue ESCREVER nele? Ler e escrever são permissões diferentes, e um canal de avisos
// costuma negar a segunda. Falhar aqui, com a receita na tela, é muito melhor do que descobrir
// na primeira pessoa que entra.
rest(TOKEN, `/channels/${CANAL_LOG}`)
  .then(async (c) => {
    console.log(`[bot] canal de log: #${c.name}`);
    if (await podeEscrever(TOKEN, CANAL_LOG)) console.log('[bot] e dá para escrever nele');
    else explicarSemPermissao(CANAL_LOG);
  })
  .catch((err) => console.error(`[bot] não deu para ler o canal ${CANAL_LOG}:`, err.message));

if (CANAL_RESGATE) {
  rest(TOKEN, `/channels/${CANAL_RESGATE}`)
    .then(async (c) => {
      console.log(`[bot] canal de resgate: #${c.name}`);
      if (!(await podeEscrever(TOKEN, CANAL_RESGATE))) explicarSemPermissao(CANAL_RESGATE);
    })
    .catch((err) => console.error(`[bot] não deu para ler o canal ${CANAL_RESGATE}:`, err.message));
} else {
  console.log('[bot] sem DISCORD_CANAL_RESGATE — o código sai só pelo privado');
}

// A mesma sonda para os canais dos radares. Vale ainda mais aqui do que no canal de convites:
// um radar sem permissão de escrita descarta os eventos dele (ver `entregar`, em `radar.mjs`),
// e descobrir isso no boot é melhor do que descobrir no primeiro shiny que ninguém viu.
for (const [nome, canalId] of [
  ['radar-shiny', CANAL_RADAR_SHINY],
  ['radar-depositos-saques', CANAL_RADAR_GEMAS],
  ['saques (staff)', CANAL_SAQUE_STAFF],
]) {
  if (!canalId) {
    console.log(`[bot] radar ${nome}: desligado (canal vazio no .env)`);
    continue;
  }
  rest(TOKEN, `/channels/${canalId}`)
    .then(async (c) => {
      const ok = await podeEscrever(TOKEN, canalId);
      console.log(`[bot] radar ${nome}: #${c.name}${ok ? '' : ' — SEM PERMISSÃO DE ESCRITA'}`);
      if (!ok) explicarSemPermissao(canalId);
    })
    .catch((err) => console.error(`[bot] radar ${nome}: não deu para ler o canal ${canalId}:`, err.message));
}
