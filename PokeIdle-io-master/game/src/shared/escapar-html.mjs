/**
 * Escapa texto para dentro de HTML — conteúdo de elemento OU valor de atributo.
 *
 * Mora em `shared/` por um motivo bem concreto: a versão do jogo (`app.js`) escapava só
 * `< > &` e a do painel (`admin.mjs`) escapava também `"`. Duas cópias da mesma função com
 * regras diferentes é exatamente o formato de um buraco que ninguém vê — e a que estava para
 * trás era a do arquivo que desenha texto de OUTROS JOGADORES.
 *
 * ### Por que as aspas mudam tudo
 *
 * Escapando só `< > &`, o texto é seguro dentro do conteúdo de um elemento e inseguro dentro de
 * um atributo. `app.js` tem dezenas de `title="${escapar(x)}"`: basta uma aspa no texto para
 * fechar o atributo e o resto virar marcação — `" onmouseover=alert(1) x="` não contém `<`
 * nenhum e passava inteiro.
 *
 * Nada disso era explorável quando o conserto entrou (nick é `[a-zA-Z0-9_]{3,16}`, o chat vai
 * para conteúdo e não para atributo, e nome de pokémon vem do catálogo do servidor). O problema
 * era a segurança do arquivo depender de ninguém, nunca, pôr texto livre num atributo: a
 * primeira descrição de guild, apelido de pokémon ou recado no anúncio quebraria isso sem um
 * único aviso. E XSS num jogo não é enfeite — o token de sessão vive no `localStorage`, então é
 * conta tomada, e no chat se espalha sozinho para quem ler a mensagem.
 *
 * O `'` entra pelo mesmo centavo: nem todo atributo do cliente usa aspas duplas, e depender de
 * qual aspa cada trecho escolheu é a mesma aposta de novo.
 */
const ESCAPES = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };

/** `null`/`undefined` viram string vazia — a versão antiga estourava com `s.replace` de undefined. */
export const escaparHtml = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ESCAPES[c]);
