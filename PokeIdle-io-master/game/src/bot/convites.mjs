// A ATRIBUIÇÃO: descobrir por qual link cada pessoa entrou, e quem criou aquele link.
//
// ### O problema, e por que ele é resolvido assim
//
// O Discord NÃO diz, no evento de entrada, qual convite foi usado. O `GUILD_MEMBER_ADD` traz o
// usuário e mais nada. A única forma de saber é comparar o contador de usos de cada convite
// antes e depois:
//
//   · o bot guarda em memória `{ code → uses }` de todo convite do servidor;
//   · alguém entra;
//   · o bot relê a lista e procura o convite cujo `uses` subiu;
//   · o `inviter` daquele convite é o padrinho.
//
// É como todo bot de convites funciona, e o motivo de o bot precisar de **MANAGE_GUILD**: sem
// essa permissão, `GET /guilds/{id}/invites` devolve 403 e não há o que comparar.
//
// ### Os três casos em que a conta não fecha, e o que se faz com eles
//
//   **Duas entradas no mesmo instante, por links diferentes.** Dois contadores sobem entre uma
//   leitura e a outra, e não dá para saber quem veio de qual. O bot serializa as entradas numa
//   fila (`fila` abaixo): cada uma relê e resolve inteira antes de a seguinte começar, e o
//   `uses` de cada uma é comparado com o retrato imediatamente anterior. Duas entradas no mesmo
//   MILISSEGUNDO pelo mesmo link continuam sendo dois pontos do mesmo padrinho, que é o certo.
//
//   **Link de uso único que some ao ser usado.** O convite desaparece da lista em vez de subir
//   o contador. Por isso a comparação também olha para quem SUMIU do retrato: um convite que
//   existia, tinha `max_uses` a um passo do fim e não está mais lá é o que foi usado.
//
//   **Vanity URL (`discord.gg/pokeidle`).** Não é convite: não aparece na lista e não tem dono.
//   A entrada é registrada sem padrinho. É a maioria das entradas de um servidor de jogo, e é
//   correto que ninguém ganhe ponto por ela.
//
// ### A régua de um ano
//
// Quem entra só vale ponto se a CONTA DE DISCORD tiver mais de um ano (ver
// `shared/convites.mjs`). A data está cravada no id, então não há como forjar. O bot registra a
// entrada dos dois jeitos — a pessoa aparece no canal com ou sem ponto —, e é `vale_ponto` que
// decide se ela entra na conta do padrinho.
import * as convdb from '../server/convites-db.mjs';
import {
  MARCOS, contaVelhaOBastante, criadoEmDoSnowflake, marcosAlcancados, proximoMarco,
} from '../shared/convites.mjs';
import {
  EFEMERA, listarConvites, listarMembros, listarMensagens, mandarNoCanal, mandarNoPrivado,
  responderInteracao, ErroDiscord,
} from './discord.mjs';

/**
 * O 403 do canal de log ja foi explicado? A receita e' longa e nao muda entre uma entrada e a
 * seguinte; repeti-la a cada pessoa que entra enterraria as linhas que importam.
 */
let jaExpliquei403 = false;

/** A receita do 403, escrita uma vez. */
export function explicarSemPermissao(canalLogId) {
  if (jaExpliquei403) return;
  jaExpliquei403 = true;
  console.error('[bot] --------------------------------------------------------------');
  console.error(`[bot] SEM PERMISSAO PARA ESCREVER no canal ${canalLogId}.`);
  console.error('[bot] A contagem CONTINUA funcionando — o que se perde e o aviso no canal.');
  console.error('[bot] No Discord: clique no canal -> Editar Canal -> Permissoes -> Adicionar');
  console.error('[bot] membro/cargo -> o bot (ou o cargo dele) -> ligar ENVIAR MENSAGENS.');
  console.error('[bot] Ver o canal e escrever nele sao permissoes diferentes; a primeira ja esta.');
  console.error('[bot] --------------------------------------------------------------');
}

/** O retrato dos convites do servidor: `code → { usos, donoId, donoNome, maxUsos }`. */
let retrato = new Map();

/** Lê a lista de convites e devolve o retrato novo. */
export async function lerConvites(token, guildId) {
  const lista = await listarConvites(token, guildId);
  const mapa = new Map();
  for (const c of lista ?? []) {
    mapa.set(c.code, {
      usos: Number(c.uses) || 0,
      maxUsos: Number(c.max_uses) || 0,
      donoId: c.inviter?.id ?? null,
      donoNome: c.inviter?.username ?? null,
    });
  }
  return mapa;
}

/**
 * Registra, sem padrinho, todo mundo que JÁ está no servidor.
 *
 * Roda no boot, antes de o bot começar a contar. É a trava contra o mutirão de "sai e volta pelo
 * meu link": sem uma linha, a reentrada de um membro antigo seria um INSERT com padrinho. Ver
 * `semearMembros`, em `convites-db.mjs`.
 *
 * @returns `{ vistos, novos }`
 */
export async function semearMembrosExistentes(token, guildId) {
  const membros = await listarMembros(token, guildId);
  const novos = await convdb.semearMembros(membros
    .filter((m) => m?.user?.id && !m.user.bot)
    .map((m) => ({
      discordId: m.user.id,
      nome: m.user.global_name || m.user.username || null,
      entrouEm: m.joined_at ? Date.parse(m.joined_at) : null,
      contaCriadaEm: criadoEmDoSnowflake(m.user.id),
      valePonto: contaVelhaOBastante(m.user.id),
    })));
  return { vistos: membros.length, novos };
}

/** Recarrega o retrato. Chamado no READY e sempre que um convite nasce ou morre. */
export async function recarregarRetrato(token, guildId) {
  retrato = await lerConvites(token, guildId);
  return retrato.size;
}

/**
 * Qual convite foi usado, comparando o retrato antigo com o novo.
 *
 * Devolve `{ code, donoId, donoNome }` ou `null`. Dois candidatos (dois contadores subiram na
 * mesma janela) devolvem `null` de propósito: creditar o errado é pior do que não creditar,
 * porque o ponto errado fica no banco e o certo nunca chega.
 */
export function acharConviteUsado(antes, depois) {
  const candidatos = [];
  for (const [code, novo] of depois) {
    const velho = antes.get(code);
    if (velho && novo.usos > velho.usos) candidatos.push({ code, ...novo });
  }
  // Uso único que se esgotou: some da lista em vez de subir o contador.
  for (const [code, velho] of antes) {
    if (depois.has(code)) continue;
    if (velho.maxUsos > 0 && velho.usos === velho.maxUsos - 1) candidatos.push({ code, ...velho });
  }
  return candidatos.length === 1 ? candidatos[0] : null;
}

// ------------------------------------------------------------------ a fila
//
// Toda entrada passa por aqui, uma de cada vez. Duas entradas em paralelo leriam a lista de
// convites ao mesmo tempo e as duas veriam os dois contadores subirem — e nenhuma das duas
// saberia dizer qual era a sua. Serializar custa alguns milissegundos por pessoa e é o que
// torna a atribuição determinística.

let fila = Promise.resolve();

const enfileirar = (fn) => {
  const p = fila.then(fn, fn);
  fila = p.catch(() => {});
  return p;
};

/**
 * Trata uma entrada no servidor.
 *
 * @returns `{ membro, padrinho, convidados, marcosNovos }` — `padrinho` é `null` quando não
 *          deu para atribuir.
 */
export function aoEntrarMembro({ token, guildId, canalLogId, membro }) {
  return enfileirar(async () => {
    const usuario = membro?.user;
    if (!usuario?.id || usuario.bot) return null;

    const antes = retrato;
    const depois = await lerConvites(token, guildId).catch((err) => {
      console.error('[bot] leitura de convites falhou:', err.message);
      return null;
    });
    // Sem lista nova não há comparação possível. A entrada é registrada sem padrinho em vez de
    // ficar de fora: perder o ponto é ruim, perder a linha é pior.
    if (depois) retrato = depois;
    const usado = depois ? acharConviteUsado(antes, depois) : null;

    const criadaEm = criadoEmDoSnowflake(usuario.id);
    const valePonto = contaVelhaOBastante(usuario.id);
    const r = await convdb.registrarMembro({
      discordId: usuario.id,
      padrinhoId: usado?.donoId ?? null,
      conviteCodigo: usado?.code ?? null,
      nome: usuario.global_name || usuario.username || null,
      contaCriadaEm: criadaEm,
      valePonto,
    });

    // O padrinho que vale é o do BANCO, não o desta entrada: quem já estava registrado com
    // padrinho (reentrou no servidor) mantém o de antes — ver `registrarMembro`.
    const padrinhoId = r.padrinhoId;
    const convidados = padrinhoId ? await convdb.contarConvidados(padrinhoId) : 0;

    await anunciarEntrada({
      token, canalLogId, usuario, padrinhoId, convidados, valePonto, criadaEm,
    });

    const marcosNovos = padrinhoId && r.valePonto
      ? await gerarCodigosDosMarcos({ token, canalLogId, padrinhoId, convidados })
      : [];

    return { membro: usuario.id, padrinho: padrinhoId, convidados, marcosNovos };
  });
}

/** Alguém saiu: o ponto dele para de contar. */
export function aoSairMembro({ usuarioId }) {
  return enfileirar(() => convdb.registrarSaida(usuarioId).catch((err) => {
    console.error('[bot] registro de saída falhou:', err.message);
  }));
}

// ------------------------------------------------------------------ o canal

const mencao = (id) => `<@${id}>`;

/** A linha do canal: quem entrou, por quem foi convidado e quantos aquele padrinho já trouxe. */
async function anunciarEntrada({ token, canalLogId, usuario, padrinhoId, convidados, valePonto, criadaEm }) {
  if (!canalLogId) return;
  const idade = criadaEm
    ? `<t:${Math.floor(criadaEm / 1000)}:R>`
    : 'desconhecida';
  const linhas = [
    `**${usuario.global_name || usuario.username}** (${mencao(usuario.id)}) entrou.`,
    padrinhoId
      ? `Convidado por ${mencao(padrinhoId)} — **${convidados}** convidado(s) válidos.`
      : 'Sem convite atribuído (link do servidor, vanity ou dois links usados juntos).',
    `Conta criada ${idade}.${valePonto ? '' : ' **Não conta ponto** — menos de 1 ano de Discord.'}`,
  ];
  await mandarNoCanal(token, canalLogId, { content: linhas.join('\n') })
    .catch((err) => {
      if (err instanceof ErroDiscord && err.status === 403) return explicarSemPermissao(canalLogId);
      console.error('[bot] aviso no canal falhou:', err.message);
    });
}

// ------------------------------------------------------------------ os marcos

/**
 * SÓ CONTAR: o bot conta, atribui e anuncia no canal, mas não gera nem manda código nenhum.
 *
 * Existe para a janela em que o bot já está de pé e o JOGO ainda não tem o `/resgatar` — subir os
 * dois no mesmo minuto não dá, porque o bot é um processo à parte e o jogo só troca de versão
 * num deploy. Sem a trava, quem cruzasse o marco de 1 nesse vão receberia um código no privado,
 * digitaria `/resgatar` num cliente que não conhece o comando e veria o código virar MENSAGEM
 * PÚBLICA no chat.
 *
 * É opt-in (`DISCORD_BOT_SO_CONTAR=1`), e não o contrário, de propósito: um padrão que segura os
 * códigos seria um programa que nunca paga se alguém esquecer de desligar a variável. Ligada, ela
 * grita no boot (ver `src/bot/index.mjs`).
 *
 * Desligar não perde nada: os marcos são recalculados na entrada seguinte daquele padrinho, e
 * `gerarCodigo` é idempotente por `UNIQUE (discord_id, marco)`.
 */
// Lida a cada uso, e nao uma vez no carregamento do modulo: com a leitura congelada no import,
// `tools/teste-convites.mjs` nao conseguia neutralizar a trava para exercitar a geracao de
// codigo — os imports do ESM rodam antes do corpo de quem importa, e a variavel ja estava lida.
const SO_CONTAR = () => process.env.DISCORD_BOT_SO_CONTAR === '1';

export const soContando = SO_CONTAR;

/**
 * Gera (e manda no privado) os códigos dos marcos que este padrinho acabou de cruzar.
 *
 * Idempotente por `UNIQUE (discord_id, marco)`: reprocessar a mesma contagem — depois de um
 * restart do bot, por exemplo — não gera um segundo código do mesmo degrau. Quando o código já
 * existia, `gerarCodigo` devolve o antigo e o envio é repetido só se ele nunca saiu.
 */
export async function gerarCodigosDosMarcos({ token, canalLogId, padrinhoId, convidados }) {
  if (SO_CONTAR()) {
    // Nem gera. Um código criado agora e não enviado seria varrido pela `reenviarPendentes` no
    // minuto em que a trava saísse, e aí ele sai fora de contexto — melhor nascer depois.
    const alcancados = marcosAlcancados(convidados);
    if (alcancados.length) {
      console.log(`[bot] SO_CONTAR: ${padrinhoId} tem ${convidados} convidado(s) e cruzaria `
        + `${alcancados.map((m) => m.amigos).join(', ')} — nenhum código gerado`);
    }
    return [];
  }
  const jaTem = await convdb.marcosJaGerados(padrinhoId);
  const novos = [];
  for (const marco of marcosAlcancados(convidados)) {
    if (jaTem.has(marco.amigos)) continue;
    const { codigo } = await convdb.gerarCodigo(padrinhoId, marco.amigos, convidados);
    novos.push({ marco: marco.amigos, codigo, premios: marco.premios });
    await entregarCodigo({ token, canalLogId, padrinhoId, marco: marco.amigos, codigo, convidados });
  }
  return novos;
}

/** O privado com o código, e o carimbo de que ele saiu. */
export async function entregarCodigo({ token, canalLogId, padrinhoId, marco, codigo, convidados }) {
  // Sem token não há Discord — é o caso do `tools/teste-convites.mjs`, que exercita a contagem e
  // a geração sem falar com ninguém. O código fica guardado e sem carimbo de envio, que é
  // exatamente o estado em que a varredura de pendentes o encontraria.
  if (!token) return;
  const texto = [
    '🏆 **Marco de convites alcançado!**',
    `Você já trouxe **${convidados}** pessoa(s) para o Discord do PokeIdle e desbloqueou o marco de **${marco}**.`,
    '',
    'Resgate no chat do jogo digitando:',
    `\`\`\`\n/resgatar ${codigo}\n\`\`\``,
    'O código vale **uma vez só** — quem digitar primeiro leva. Não passe para ninguém.',
  ].join('\n');
  try {
    await mandarNoPrivado(token, padrinhoId, { content: texto });
    await convdb.marcarEnviado(codigo);
  } catch (err) {
    // 403 = privado fechado. Não é falha do bot; o código continua guardado e a staff consegue
    // repassá-lo. O canal registra para alguém poder agir.
    const fechado = err instanceof ErroDiscord && err.status === 403;
    console.error(`[bot] privado para ${padrinhoId} falhou:`, err.message);
    if (canalLogId) {
      await mandarNoCanal(token, canalLogId, {
        content: fechado
          ? `⚠️ ${mencao(padrinhoId)} bateu o marco de **${marco}** mas está com o privado fechado — o código está guardado.`
          : `⚠️ Não deu para mandar o código do marco de **${marco}** para ${mencao(padrinhoId)}.`,
      }).catch(() => {});
    }
  }
}

/**
 * Gera o que ficou para trás: todo marco já cruzado que ainda não virou código.
 *
 * `gerarCodigosDosMarcos` só roda quando ALGUÉM ENTRA, e isso deixa um buraco toda vez que a
 * contagem avança sem o bot por perto: ele estava fora do ar, ou estava com
 * `DISCORD_BOT_SO_CONTAR` ligado (a janela em que o jogo ainda não tinha o `/resgatar`). Nesses
 * casos o padrinho fica com o marco cruzado e sem código, esperando a próxima pessoa entrar
 * pelo link dele — que pode não vir nunca.
 *
 * Roda no boot, depois da semeadura (a contagem precisa estar certa). É idempotente por
 * `UNIQUE (discord_id, marco)`: quem já tem o código do degrau não ganha um segundo.
 *
 * @returns quantos códigos nasceram
 */
export async function varrerMarcosAtrasados({ token, canalLogId }) {
  if (SO_CONTAR()) return 0;
  const todos = await convdb.contagemDeTodos();
  let novos = 0;
  for (const { padrinhoId, convidados } of todos) {
    const gerados = await gerarCodigosDosMarcos({ token, canalLogId, padrinhoId, convidados })
      .catch((err) => {
        console.error(`[bot] marco atrasado de ${padrinhoId} falhou:`, err.message);
        return [];
      });
    for (const g of gerados) {
      console.log(`[bot] marco ATRASADO ${g.marco} de ${padrinhoId} (${convidados}) → ${g.codigo}`);
    }
    novos += gerados.length;
  }
  return novos;
}

/**
 * Tenta de novo os privados que nunca saíram. Roda de tempos em tempos: o `retry_after` de um
 * 429 pode passar do fim do processo, e um marco sem código entregue é prêmio que o jogador
 * ganhou e não recebeu.
 */
export async function reenviarPendentes({ token, canalLogId }) {
  if (SO_CONTAR()) return 0;
  const pendentes = await convdb.codigosPorEnviar(20).catch(() => []);
  for (const p of pendentes) {
    await entregarCodigo({
      token, canalLogId, padrinhoId: p.discordId, marco: p.marco, codigo: p.codigo,
      convidados: p.convidados,
    });
  }
  return pendentes.length;
}

/** Só para o teste e para a varredura: o retrato atual. */
export const retratoAtual = () => retrato;
export const definirRetrato = (m) => { retrato = m; };

// ------------------------------------------------ o painel de resgate (botão)
//
// ### Por que um BOTÃO, e não uma mensagem marcando a pessoa
//
// O código é um ticket com valor e vale em qualquer conta: postá-lo num canal aberto, mesmo
// marcando o dono, é entregá-lo a quem ler primeiro. E o Discord não deixa um bot mandar
// mensagem EFÊMERA (visível a uma pessoa só) por vontade própria — `flags: EFEMERA` só existe
// como RESPOSTA a uma interação.
//
// Daí o desenho: uma mensagem fixa no canal, com um botão. Quem clica recebe uma resposta que
// só ele enxerga, com os códigos dele. Ninguém mais vê, nem quem estiver olhando o canal na
// hora, nem quem rolar o histórico depois.
//
// De quebra, isso resolve três coisas que a DM não resolvia: quem tem o privado fechado (o erro
// 50278 que apareceu no primeiro dia), quem apagou a mensagem sem querer, e quem quer conferir
// quantos convidados já tem sem perguntar a ninguém.

/** O `custom_id` do botão. É por ele que a interação é reconhecida na volta. */
const BOTAO_RESGATE = 'convites:meu-codigo';

/** O corpo da mensagem fixa do canal de resgate. */
function mensagemDoPainel() {
  const escada = MARCOS
    .map((m) => `**${m.amigos}** ${m.amigos === 1 ? 'convidado' : 'convidados'}`)
    .join(' · ');
  return {
    content: [
      '# 🎟️ Convide & Ganhe',
      '',
      'Traga gente para o servidor **pelo SEU link de convite** e cada pessoa vira um ponto.',
      'Ao cruzar um marco, o seu código aparece aqui — clique no botão abaixo.',
      '',
      `**Os marcos:** ${escada}`,
      '',
      '**Como criar o seu link:** botão direito no canal → *Convidar Pessoas* → *Editar link* → '
        + '**Nunca expirar** e **Usos ilimitados**. O link geral do servidor não conta para ninguém.',
      '',
      '**Como resgatar:** pegue o código no botão e digite `/resgatar <codigo>` no chat do jogo.',
      '',
      '-# Só conta quem entra com conta de Discord de mais de 1 ano. A resposta do botão é '
        + 'privada — só você a enxerga.',
    ].join('\n'),
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 3,
        label: 'Pegar meu código',
        emoji: { name: '🎟️' },
        custom_id: BOTAO_RESGATE,
      }],
    }],
  };
}

/**
 * Garante que a mensagem com o botão existe no canal. Idempotente.
 *
 * Procura nas últimas mensagens uma do próprio bot que já carregue o botão; achando, não posta
 * nada. Sem essa varredura, cada restart do serviço empilharia mais um painel no canal.
 *
 * Quando o bot não consegue LER o histórico (falta READ_MESSAGE_HISTORY), a busca falha e ele
 * posta assim mesmo: um painel repetido é um problema menor do que canal nenhum.
 */
export async function garantirPainelDeResgate({ token, canalId }) {
  if (!canalId) return null;
  let jaTem = null;
  try {
    const msgs = await listarMensagens(token, canalId, 50);
    jaTem = (msgs ?? []).find((m) => (m.components ?? [])
      .some((l) => (l.components ?? []).some((c) => c.custom_id === BOTAO_RESGATE)));
  } catch (err) {
    console.error('[bot] não deu para ler o histórico do canal de resgate:', err.message);
  }
  if (jaTem) return jaTem.id;
  const nova = await mandarNoCanal(token, canalId, mensagemDoPainel());
  console.log(`[bot] painel de resgate publicado em ${canalId}`);
  return nova?.id ?? null;
}

/**
 * O clique no botão. Responde SÓ para quem clicou.
 *
 * Três respostas possíveis, e cada uma é a frase que aquela pessoa precisa ler:
 *
 *   sem convidado   quantos faltam para o primeiro marco, e como criar o link;
 *   com código      o código, e o comando pronto para copiar;
 *   tudo resgatado  o que ela já pegou e qual é o próximo degrau.
 *
 * O código é marcado como ENVIADO ao ser mostrado: isso desliga a varredura de privados
 * pendentes para ele. Quem clicar de novo continua vendo o código (a lista é dos NÃO
 * RESGATADOS, não dos não enviados) — perder a mensagem não pode custar o prêmio.
 */
export async function aoClicarNoBotao({ token, interacao }) {
  const usuarioId = interacao?.member?.user?.id ?? interacao?.user?.id;
  if (!usuarioId) return;
  const p = await convdb.painelDoPadrinho(usuarioId);
  const prox = proximoMarco(p.convidados);
  const faltam = prox ? prox.amigos - p.convidados : 0;

  let texto;
  if (p.abertos.length) {
    const linhas = p.abertos.map((c) => `**Marco de ${c.marco}** → \`/resgatar ${c.codigo}\``);
    texto = [
      `🎟️ Você tem **${p.abertos.length}** código(s) para resgatar:`,
      '',
      ...linhas,
      '',
      'Digite o comando no **chat do jogo**. Cada código vale uma vez só.',
      prox ? `\nVocê tem **${p.convidados}** convidado(s) — faltam **${faltam}** para o marco de **${prox.amigos}**.` : '',
    ].join('\n');
    for (const c of p.abertos) await convdb.marcarEnviado(c.codigo).catch(() => {});
  } else if (p.convidados > 0) {
    texto = [
      `Você tem **${p.convidados}** convidado(s) válido(s).`,
      p.resgatados ? `Já resgatou **${p.resgatados}** código(s).` : '',
      prox
        ? `Faltam **${faltam}** para o marco de **${prox.amigos}** — quando chegar lá, o código aparece aqui.`
        : 'Você já passou do último marco. 🏆',
    ].filter(Boolean).join('\n');
  } else {
    texto = [
      'Você ainda não tem convidados válidos.',
      '',
      '**Crie o SEU link:** botão direito no canal → *Convidar Pessoas* → *Editar link* → '
        + '**Nunca expirar** e **Usos ilimitados**.',
      'O link geral do servidor não conta para ninguém — só o que você criar sabe que a pessoa é sua.',
      '',
      '-# Só conta quem entra com conta de Discord de mais de 1 ano.',
    ].join('\n');
  }

  await responderInteracao(token, interacao.id, interacao.token, {
    content: texto,
    flags: EFEMERA,
  }).catch((err) => console.error('[bot] resposta ao botão falhou:', err.message));
}

export { BOTAO_RESGATE };
