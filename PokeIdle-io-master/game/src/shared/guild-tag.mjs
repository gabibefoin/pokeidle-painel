// A TAG da guild — as até três letras que aparecem ao lado do nick no chat, na cor que o dono
// escolher.
//
// Mora em `shared/` porque as duas pontas precisam da MESMA régua: o servidor valida o que
// chega (`guild.tag`, `guild.criar`) e o cliente desenha a paleta e o campo com o mesmo teto de
// letras. Escrever o limite em dois lugares seria a receita conhecida — a tela aceitando quatro
// letras e o servidor cortando para três, sem explicar.

/** Quantas letras a tag tem, no máximo. Três é o que cabe antes do nick sem empurrar a fala. */
export const MAX_TAG_GUILD = 3;

/**
 * A espera entre duas trocas de tag: 24 h, a MESMA do brasão (`BRASAO_EDITAR_MS`).
 *
 * As duas são a identidade da guild vista de fora, e a razão da espera é a mesma: a tag fica
 * colada no nick de cada membro no chat do Mundo, e quem lê a conversa aprende a reconhecê-la.
 * Uma guild trocando de `[SOL]` para `[LUA]` a cada dez minutos não tem identidade nenhuma — e
 * ainda ganha, de graça, um jeito de despistar quem a estava acompanhando.
 *
 * Mora aqui e não em `game/guild.mjs` porque a TELA também precisa: é com este número que o
 * botão vira "Aguarde 7 h" em vez de mandar um pedido que o servidor já vai recusar.
 */
export const TAG_EDITAR_MS = 24 * 60 * 60 * 1000;

/**
 * As cores que a tag pode ter.
 *
 * NÃO é a paleta do brasão (`CORES_BRASAO`), e a diferença não é estética: o brasão é desenhado
 * sobre a tábua clara, e a tag vive no chat — que é a única tela do jogo com fundo de vidro
 * PRETO (ver §5 do DESIGN.md). Metade das cores do brasão (`#212529`, `#1d3557`, `#3d2c1e`) some
 * ali. Oferecer uma cor invisível é oferecer ao jogador a chance de desaparecer sem saber.
 */
export const CORES_TAG = [
  '#ffd166', '#ffb703', '#ff8a50', '#ef476f', '#ff006e', '#ffb3c7',
  '#c89bff', '#8338ec', '#7fd4ff', '#4dd0e1', '#06d6a0', '#8ce8b4',
  '#b2ff59', '#ffffff',
];

/** O ouro da casa — a mesma cor do troféu e do nível no ranking. */
export const COR_TAG_PADRAO = '#ffd166';

/**
 * Tags que ninguém pode usar.
 *
 * O chat marca a equipe com `[ADM]`, `[MOD]`, `[HLP]` e `[STREAMER]`, e a tag da guild fica na
 * MESMA linha, a dois caracteres de distância — desde que os selos encolheram para três letras,
 * eles têm exatamente o FORMATO de uma tag de guild, o que torna esta lista mais necessária,
 * não menos. Sem esta lista, abrir uma guild
 * chamada "Administração" e sair pelo Mundo com `[ADM]` colado no nick custaria 250k de ouro e
 * enganaria bem — a diferença entre os dois selos é a cor, e a cor é justamente o que o dono
 * escolhe.
 */
export const TAGS_RESERVADAS = new Set(['ADM', 'MOD', 'HLP', 'GM', 'STF', 'DEV', 'BOT', 'SYS']);

/** Só letra e número: espaço, hífen e `_` (que o NOME aceita) não cabem em três caracteres. */
const SO_ALFANUM = /[^a-zA-Z0-9]/g;

/**
 * O que a tag VIRA antes de ser comparada com a lista de reservadas.
 *
 * `M0D` com zero, `A0M`, `5YS` — a lista literal pararia em `MOD` e deixaria passar a versão
 * com número, que no corpo de 10 px do chat é indistinguível da letra. Só para a CONFERÊNCIA:
 * a tag gravada continua sendo o que a pessoa digitou.
 */
const SOSIAS = { 0: 'O', 1: 'I', 3: 'E', 4: 'A', 5: 'S', 6: 'G', 7: 'T', 8: 'B' };
const semSosias = (s) => s.replace(/[01345678]/g, (d) => SOSIAS[d]);

/** Por que a tag foi recusada: `'vazia'`, `'reservada'` ou `null` (passou). */
export function motivoTagInvalida(raw) {
  const s = String(raw ?? '').replace(SO_ALFANUM, '').toUpperCase().slice(0, MAX_TAG_GUILD);
  if (!s) return 'vazia';
  if (TAGS_RESERVADAS.has(s) || TAGS_RESERVADAS.has(semSosias(s))) return 'reservada';
  return null;
}

/**
 * Normaliza e valida a tag que chegou. Devolve a tag em CAIXA ALTA ou `null`.
 *
 * Caixa alta sempre: `[fas]` e `[FAS]` seriam duas guilds diferentes de relance, e a tag é lida
 * no canto do olho, no meio de uma conversa que rola.
 */
export function tagGuildValida(raw) {
  if (motivoTagInvalida(raw)) return null;
  return String(raw).replace(SO_ALFANUM, '').toUpperCase().slice(0, MAX_TAG_GUILD);
}

/** A cor pedida, ou o padrão. Fora da paleta não passa — ver o comentário de `CORES_TAG`. */
export function corTagValida(raw) {
  const c = String(raw ?? '').toLowerCase();
  return CORES_TAG.includes(c) ? c : COR_TAG_PADRAO;
}

/**
 * A tag que a guild GANHA ao nascer: as três primeiras letras do nome.
 *
 * "Lua Cheia" vira `LUA`, "FASI GUILD" vira `FAS`. Ninguém precisa escolher nada para ter uma
 * tag — o dono muda depois se quiser. Nome que sobra com menos de três alfanuméricos devolve o
 * que houver.
 *
 * Devolve `null` em dois casos, e nos dois a guild simplesmente nasce SEM tag (melhor do que
 * com um par de colchetes vazios no chat): nome sem nenhum alfanumérico — impossível pelo
 * `nomeGuildValido`, mas barato de cobrir — e nome cujas três primeiras letras caem numa tag
 * RESERVADA, como "Adm Team". Aí o dono escolhe uma no painel.
 */
export function tagPadraoDoNome(nome) {
  return tagGuildValida(String(nome ?? '').replace(SO_ALFANUM, '').slice(0, MAX_TAG_GUILD));
}
