// Sessão de teste via conta registrada (criar ou entrar). Substitui /auth/convidado.
//
//   import { sessaoPara, helloCom } from './auth-teste.mjs';
//   const sessao = await sessaoPara('meu_nick');
//   ws.send(JSON.stringify(helloCom(sessao)));

const HTTP = process.env.HTTP_URL ?? 'http://localhost:8080';
const SENHA = process.env.TEST_SENHA ?? 'teste1234';

/** Devolve `{ nick, token }` para abrir o WebSocket. Cria a conta se ainda não existir. */
export async function sessaoPara(nick, opts = {}) {
  const http = opts.http ?? HTTP;
  const senha = opts.senha ?? SENHA;
  // `gmail.com` e não `test.local`: o cadastro passou a recusar domínio fora da lista de
  // `shared/email-cadastro.mjs` (é o que barra caixa temporária), e a lista não tem como
  // abrir uma exceção só para teste sem abri-la para todo mundo. O endereço não é usado para
  // nada aqui — em dev o Resend fica desligado e nenhum e-mail sai.
  const email = opts.email ?? `${String(nick).replace(/[^a-zA-Z0-9]/g, '')}@gmail.com`;

  let r = await fetch(`${http}/auth/entrar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: nick, senha }),
  });
  if (r.ok) {
    const d = await r.json();
    if (d.precisaNick) throw new Error(`conta ${nick} precisa escolher nick antes de jogar`);
    return { nick: d.nick, token: d.token };
  }

  r = await fetch(`${http}/auth/criar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nick, email, senha }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.erro ?? `auth falhou para ${nick}`);
  if (d.precisaConfirmar) {
    throw new Error('servidor exige confirmação de e-mail — desligue RESEND_API_KEY em dev');
  }
  if (d.precisaNick) {
    throw new Error(`conta ${nick} criada sem nick — desligue Resend em dev ou escolha nick`);
  }
  return { nick: d.nick, token: d.token };
}

export function helloCom(sessao) {
  return { t: 'hello', nick: sessao.nick, token: sessao.token };
}

/**
 * URL do JOGO já com a sessão embutida. `base` é a ORIGEM (`http://localhost:8080`), não o
 * endereço da página: o jogo mora em `/app` desde que a raiz virou a landing page, e colar
 * `/` no fim de uma base que já apontava para lá daria `/app/` — que o gateway resolve como
 * diretório e devolve 404.
 */
export function sessaoParaUrl(sessao, base = 'http://localhost:8080') {
  const b64 = Buffer.from(JSON.stringify(sessao)).toString('base64');
  const u = new URL('/app', base);
  u.searchParams.set('sessao', b64);
  return u.toString();
}

/** URL pronta para abrir o jogo logado (substitui `?nick=`). */
export async function urlEntrada(nick, base = HTTP) {
  return sessaoParaUrl(await sessaoPara(nick, { http: base.replace(/\/$/, '') }), base);
}
