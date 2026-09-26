// OS RADARES — o bot lendo o banco do jogo e contando no Discord o que acabou de acontecer.
//
// Três canais, quatro eventos:
//
//   ✨┃radar-shiny              alguém capturou um shiny
//   🤑┃radar-depositos-saques   um saque foi aprovado · um depósito entrou
//   (canal da staff)            um saque foi PEDIDO — com menção ao cargo que aprova
//
// ### O laço, e por que ele é um laço e não um gatilho
//
// O jogo não avisa o bot de nada: são processos diferentes, e o sim é shardado em dez. Um
// gatilho (Redis pub/sub, que o jogo já usa para o chat) entregaria o evento no instante — e
// perderia tudo que acontecesse enquanto o bot estivesse fora do ar, que é justamente quando
// não se quer perder nada. O laço com cursor no banco (ver `radar-db.mjs`) troca alguns
// segundos de atraso por essa garantia: o bot pode passar a madrugada reiniciando que, ao
// voltar, anuncia o que ficou para trás na ordem em que aconteceu.
//
// ### O cursor anda POR EVENTO, e só depois de o Discord confirmar
//
// Um ciclo não é uma transação. Se a terceira mensagem de cinco falhar, as duas primeiras já
// foram e não podem voltar — então o cursor avança de uma em uma, depois do `POST`. O pior
// caso vira UMA mensagem repetida (o processo morrer entre o envio e a gravação do cursor), e
// não um bloco inteiro perdido ou repetido.
//
// ### Menção: só o cargo, nunca o que veio do banco
//
// Todo `POST` vai com `allowed_mentions` explícito. O nick do jogador entra na frase, e nick é
// texto que o JOGADOR escolheu: sem essa trava, alguém chamado `@everyone` faria o bot tocar o
// servidor inteiro a cada shiny. A única menção permitida é a do cargo da staff, e só na
// mensagem em que ela foi pedida.
import { ErroDiscord, mandarNoCanal } from './discord.mjs';
import * as radardb from '../server/radar-db.mjs';
// O catálogo do jogo, para o radar de shiny dizer a espécie e calcular a NOTA.
//
// São 103 ms e 28 MB no boot do bot, e não tem substituto barato: a nota depende das bases da
// espécie COM as heranças (Outland, Orre, refino) e do piso da linhagem que `anotarLinhagemDaNota`
// pendura em cada uma. O espelho cru (`creatures.json`) tem 486 espécies e não conhece as
// variantes — pelo id `2048` ele devolve `undefined`. O catálogo montado tem 1.218 e é o MESMO
// que o jogo usa, então o `N=` do canal é o `N=` do card, sem uma segunda fórmula para divergir.
import { especies } from '../server/content.mjs';
import { notaDePokemon } from '../shared/nota-pokemon.mjs';
import { normalizarRefino } from '../shared/refino-stats.mjs';

/** De quanto em quanto tempo o bot pergunta ao banco se aconteceu algo novo. */
export const INTERVALO_PADRAO_MS = 10_000;

/**
 * Idade a partir da qual uma captura de shiny deixa de ser notícia e é descartada.
 *
 * O cursor faz o bot reencontrar tudo o que aconteceu enquanto ele esteve fora do ar — e isso
 * é o certo para dinheiro, mas não para o radar de shiny. Um bot que passe o fim de semana
 * parado voltaria despejando duzentas capturas de dois dias atrás, em rajada, num canal que
 * existe para dizer "olha o que ACABOU de acontecer". As velhas são puladas (o cursor anda
 * por cima delas), com uma linha no log dizendo quantas.
 *
 * Os dois feeds de dinheiro NÃO têm esse corte, e a assimetria é de propósito: eles são poucos
 * por dia, e um depósito de ontem que ninguém anunciou é um registro faltando, não spam. O
 * pedido de saque então nem se discute — ele é uma tarefa pendente da staff, e uma tarefa não
 * vence por ficar velha.
 */
const SHINY_VELHO_MS = 60 * 60_000;

/** A regra acima, isolada para o teste poder afirmar os dois lados dela. */
export const shinyVelhoDemais = (linha, agora = Date.now()) =>
  agora - new Date(linha?.caught_at).getTime() > SHINY_VELHO_MS;

// ---------------------------------------------------------------- formatação

/**
 * Separador de milhar à mão, e não `toLocaleString('pt-BR')`.
 *
 * O `toLocaleString` com locale depende do ICU completo estar embutido no Node — quando não
 * está, ele não falha: devolve `1029` em vez de `1.029`, silenciosamente, só em produção. Uma
 * regex de três caracteres não tem esse modo de falha.
 */
const milhar = (n) => String(Math.trunc(Math.abs(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const gemas = (v) => `${milhar(v)} ${Math.abs(Number(v)) === 1 ? 'gema' : 'gemas'}`;

const dolar = (v) => {
  const [inteiro, centavos] = (Number(v) || 0).toFixed(2).split('.');
  return `US$ ${milhar(inteiro)},${centavos}`;
};

/**
 * Texto vindo do banco pronto para entrar numa frase do Discord.
 *
 * Nick é escolha do jogador, e o Discord interpreta markdown em qualquer lugar: um nick com
 * `**` fecharia o negrito no meio da frase, e um com crase abriria um bloco de código que
 * engoliria o resto da linha. A quebra de linha vai junto — ela viraria uma segunda linha
 * fora do formato.
 */
const seguro = (txt) =>
  String(txt ?? '')
    .replace(/[\\*_~`|]/g, (c) => `\\${c}`)
    .replace(/\s+/g, ' ')
    .slice(0, 64)
    .trim();

/** `<t:…:R>` — o "há 2 minutos" que o Discord recalcula sozinho no fuso de quem lê. */
const quando = (data) => {
  const ms = new Date(data).getTime();
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:R>` : '';
};

/** Vírgula decimal, como o jogo escreve em toda parte (`virgula`, no app.js). */
const virgula = (s) => String(s).replace('.', ',');

/**
 * A FILEIRA DE SELOS do pokémon: `P3 · IV 122 · Q 1,542 · N 7,155`.
 *
 * É o mesmo conjunto, na mesma ordem e com a mesma formatação de `selosAtributos` (app.js) —
 * potência, IV somado, qualidade com três casas, nota com três casas. Copiar a ordem e as
 * casas decimais não é preciosismo: quem lê o canal vai abrir a ficha do bicho em seguida, e
 * dois números que deveriam ser o mesmo escritos de jeitos diferentes viram "o bot errou".
 *
 * A nota sai de `notaDePokemon`, a MESMA função do cliente e do Mercado. Sem a espécie no
 * catálogo ela devolve `null` — e aí o selo cai fora sozinho, em vez de virar um `N —`.
 */
export function selosDoShiny(linha) {
  const esp = especies.get(Number(linha.species_id)) ?? null;
  const ivs = typeof linha.ivs === 'string' ? JSON.parse(linha.ivs) : linha.ivs;
  const ivTotal = ivs ? Object.values(ivs).reduce((s, v) => s + (Number(v) || 0), 0) : null;
  const q = Number(linha.quality);
  const potencia = Math.max(1, Math.min(5, Number(linha.potencia) || 1));
  // SEM espécie no catálogo, sem nota. `notaDePokemon` até devolve um número nesse caso (ele
  // cai numa base de referência), mas um número tirado contra a base errada é pior do que selo
  // nenhum: ele parece uma medida e não é.
  const nota = esp
    ? notaDePokemon(
      {
        ivs,
        quality: q,
        potencia,
        shiny: true,
        refino: normalizarRefino(linha.bonus_base),
      },
      esp,
    )
    : null;
  return {
    nome: esp?.name ?? `#${linha.species_id}`,
    potencia,
    selos: [
      `P${potencia}`,
      ivTotal != null ? `IV ${milhar(ivTotal)}` : null,
      Number.isFinite(q) && q > 0 ? `Q ${virgula(q.toFixed(3))}` : null,
      nota != null && Number.isFinite(Number(nota)) ? `N ${virgula(Number(nota).toFixed(3))}` : null,
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------- as mensagens
//
// Os quatro montadores são `export` para o `tools/teste-radar.mjs` poder conferir o texto e,
// sobretudo, o `allowed_mentions` de cada um sem falar com o Discord. São funções puras: linha
// do banco entra, corpo do POST sai.

/**
 * O shiny no canal. Sem o NÍVEL, de propósito.
 *
 * Nível de bicho capturado não diz nada sobre ele — é o degrau em que a área entrega, igual
 * para todo mundo que caça ali, e sobe sozinho no primeiro combate. O que separa um shiny bom
 * de um shiny qualquer é a fileira de selos: potência, IV, qualidade e nota.
 */
export function mensagemShiny(linha) {
  const { nome, potencia, selos } = selosDoShiny(linha);
  const nick = seguro(linha.nick);
  const titulo = potencia === 5
    ? `✨🏆 **${nick}** capturou um **${seguro(nome)} shiny P5**!`
    : `✨ **${nick}** capturou um **${seguro(nome)}** shiny!`;
  return { content: `${titulo}\n-# ${selos.join(' · ')} · #${linha.id}` };
}

/**
 * O pedido de saque, no canal da staff. É a ÚNICA mensagem que menciona alguém.
 *
 * O `status` vai na linha porque o radar tem alguns segundos de atraso: um saque aprovado
 * nesse meio-tempo chegaria aqui como "nova solicitação" e mandaria a staff procurar uma fila
 * que já não existe. Com o status impresso, a mensagem se explica sozinha.
 *
 * O endereço da carteira NÃO vai — ele identifica o jogador fora do jogo, e quem precisa dele
 * o tem no painel. O que basta para achar o saque lá é o começo do id.
 */
export function mensagemSaquePedido(linha, cargoId) {
  const mencao = cargoId ? `<@&${cargoId}> ` : '';
  const curto = String(linha.id).slice(0, 8);
  return {
    content:
      `${mencao}💸 **Nova solicitação de saque**\n`
      + `**${seguro(linha.nick)}** pediu **${gemas(linha.orbs)}** → **${dolar(linha.usdt)}**\n`
      + `-# \`${seguro(linha.rede)}\` · pedido \`${curto}\` · ${quando(linha.criado_em)} · status: **${seguro(linha.status)}**`,
    allowed_mentions: cargoId ? { parse: [], roles: [String(cargoId)] } : { parse: [] },
  };
}

export function mensagemSaqueAprovado(linha) {
  return {
    content:
      `🤑 **${seguro(linha.nick)}** sacou **${gemas(linha.orbs)}** e recebeu **${dolar(linha.usdt)}**\n`
      + `-# saque aprovado · \`${seguro(linha.rede)}\``,
  };
}

export function mensagemDeposito(linha) {
  return {
    content:
      `💎 **${seguro(linha.nick)}** depositou **${dolar(linha.usdt)}** e recebeu **${gemas(linha.orbs)}**\n`
      + `-# depósito confirmado · \`${seguro(linha.rede)}\``,
  };
}

// ---------------------------------------------------------------- o laço

/** Canais que já avisaram que não dá para escrever — para o log não repetir a cada 10 s. */
const jaReclamou = new Set();

/**
 * Manda uma mensagem e diz o que fazer com o cursor.
 *
 * `'ok'`     entregue — o cursor anda.
 * `'pular'`  o Discord recusou e o feed abre mão do evento: o cursor anda mesmo assim.
 * `'parar'`  o cursor FICA, e o ciclo seguinte tenta de novo.
 *
 * ### Sem permissão no canal: quem descarta e quem espera
 *
 * 403/404 não passa com nova tentativa — é canal apagado ou permissão faltando, e isso só se
 * resolve no painel do Discord. A pergunta é o que fazer com o evento enquanto isso.
 *
 * Para o SHINY, descartar: o canal é "olha o que acabou de acontecer", já tem corte de uma
 * hora, e travar o feed no primeiro evento faria o bot repetir o mesmo erro para sempre sem
 * nunca chegar às capturas de agora.
 *
 * Para DINHEIRO, esperar. Um pedido de saque é tarefa da staff, e um depósito é registro: se o
 * canal subiu sem permissão — que foi exatamente o que aconteceu ao conferir os três canais
 * antes do primeiro deploy —, o certo é a fila segurar até alguém arrumar, e então tudo sair
 * na ordem. Descartar ali seria perder um pedido de saque porque faltou um clique num cargo.
 */
async function entregar(token, canalId, corpo, { descartarSemPermissao = false } = {}) {
  try {
    await mandarNoCanal(token, canalId, { allowed_mentions: { parse: [] }, ...corpo });
    jaReclamou.delete(canalId);
    return 'ok';
  } catch (err) {
    if (err instanceof ErroDiscord && (err.status === 403 || err.status === 404)) {
      if (!jaReclamou.has(canalId)) {
        jaReclamou.add(canalId);
        console.error(
          `[radar] o bot não consegue escrever no canal ${canalId} (${err.status}). `
          + 'Confira se o cargo do bot tem VER CANAL e ENVIAR MENSAGENS nele. '
          + (descartarSemPermissao
            ? 'Os eventos deste feed estão sendo descartados.'
            : 'A fila deste feed está SEGURANDO — nada se perde, e sai tudo quando liberar.'),
        );
      }
      return descartarSemPermissao ? 'pular' : 'parar';
    }
    console.error(`[radar] envio no canal ${canalId} falhou:`, err.message);
    return 'parar';
  }
}

/** Um feed: lê do cursor para a frente, manda, e carimba o que passou. */
async function correr({
  token, feed, canalId, buscar, montar, cursorDe,
  velhoDemais = null, descartarSemPermissao = false,
}) {
  if (!canalId) return 0;
  const cursor = await radardb.lerCursor(feed);
  if (cursor == null) return 0;
  const linhas = await buscar(cursor);
  let n = 0;
  let pulados = 0;
  for (const linha of linhas) {
    if (velhoDemais?.(linha)) {
      // Pulado, mas o cursor anda: sem isso a mesma linha velha voltaria em todo ciclo, para
      // sempre, e o feed nunca chegaria às capturas de agora.
      await radardb.gravarCursor(feed, cursorDe(linha));
      pulados++;
      continue;
    }
    const r = await entregar(token, canalId, montar(linha), { descartarSemPermissao });
    if (r === 'parar') break;
    await radardb.gravarCursor(feed, cursorDe(linha));
    if (r === 'ok') n++;
  }
  if (pulados) console.log(`[radar] ${feed}: ${pulados} evento(s) velho(s) demais — pulados`);
  return n;
}

/**
 * Liga os radares. Devolve `{ parar() }`.
 *
 * Um feed sem canal configurado simplesmente não roda — é assim que se desliga um deles sem
 * mexer no código. Os quatro rodam em SÉRIE dentro do ciclo, de propósito: em paralelo, uma
 * rajada de eventos em dois feeds ao mesmo tempo bateria no limite de requisições do Discord,
 * e o `rest()` gastaria as tentativas dele dormindo.
 */
export function iniciarRadar({
  token,
  canalShiny = '',
  canalGemas = '',
  canalSaqueStaff = '',
  cargoSaque = '',
  intervaloMs = INTERVALO_PADRAO_MS,
}) {
  let rodando = false;

  const ciclo = async () => {
    // Um ciclo que demore mais que o intervalo não pode abrir um segundo por cima do primeiro:
    // os dois leriam o mesmo cursor e anunciariam o mesmo evento duas vezes.
    if (rodando) return;
    rodando = true;
    try {
      await correr({
        token, feed: 'shiny_pk', canalId: canalShiny,
        buscar: (c) => radardb.novosShinys(c),
        montar: mensagemShiny,
        cursorDe: (l) => l.id,
        velhoDemais: shinyVelhoDemais,
        // O único feed que abre mão do evento quando o canal recusa. Ver `entregar`.
        descartarSemPermissao: true,
      });
      await correr({
        token, feed: 'saque_pedido', canalId: canalSaqueStaff,
        buscar: (c) => radardb.novosSaques(c),
        montar: (l) => mensagemSaquePedido(l, cargoSaque),
        cursorDe: (l) => l.criado_em,
      });
      await correr({
        token, feed: 'saque_aprovado', canalId: canalGemas,
        buscar: (c) => radardb.saquesAprovados(c),
        montar: mensagemSaqueAprovado,
        cursorDe: (l) => l.aprovado_em,
      });
      await correr({
        token, feed: 'deposito', canalId: canalGemas,
        buscar: (c) => radardb.novosDepositos(c),
        montar: mensagemDeposito,
        cursorDe: (l) => l.id,
      });
    } catch (err) {
      // Banco fora do ar, consulta que estourou: o ciclo seguinte tenta de novo. O cursor não
      // andou, então nada se perde — e o radar não derruba o bot de convites junto.
      console.error('[radar] ciclo falhou:', err.message);
    } finally {
      rodando = false;
    }
  };

  ciclo();
  const relogio = setInterval(ciclo, Math.max(2000, intervaloMs));
  return { parar: () => clearInterval(relogio) };
}
