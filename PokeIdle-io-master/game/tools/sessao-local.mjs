// Sessão assinada para uma conta que JÁ EXISTE no banco local.
//
//   import { sessaoDe } from './sessao-local.mjs';
//   const sessao = await sessaoDe('fasi');   // { nick, token }
//
// Por que isto existe ao lado do `auth-teste.mjs`: aquele cria conta pela rota `/auth/criar`,
// e a rota valida o domínio do e-mail contra `shared/email-cadastro.mjs` (gmail, hotmail,
// outlook, live, yahoo, icloud). O `nick@test.local` que ele monta sozinho bate em
// `login.emailDominio` e nenhuma ferramenta que dependa dele sobe — foi o que derrubou o
// `tela.mjs` depois que a lista de domínios entrou.
//
// Aqui não há cadastro: a conta já está no banco (restore de produção, ou criada à mão) e o
// token é assinado direto, do mesmo jeito que o `dev-sessao.mjs` faz. Serve para print,
// gravação e qualquer roteiro que precise de uma conta COM progresso — tela de nível 5 com um
// Rattata não presta para material de divulgação.
//
// O token só vale se o servidor rodar com o MESMO `AUTH_SEGREDO` do `.env`.
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { assinarSessao } from '../src/server/auth.mjs';

/** `{ nick, token }` para semear no `localStorage` antes de a página existir. */
export async function sessaoDe(alvo) {
  const { rows } = await pool.query(
    `SELECT id, nick, provedor FROM accounts
      WHERE lower(email) = lower($1) OR lower(nick) = lower($1)
      LIMIT 1`,
    [String(alvo).trim()],
  );
  const conta = rows[0];
  if (!conta) throw new Error(`conta "${alvo}" não existe no banco local`);

  // O `await` não é decorativo: `assinarSessao` virou `async` quando passou a buscar a época
  // da conta, e sem ele o campo `token` sai um Promise. Um Promise vira `{}` no
  // `JSON.stringify` que semeia o `localStorage`, e o cliente manda `{}` para `/auth/conta` —
  // 401 em todas as ferramentas de print, com cara de segredo trocado. O `dev-sessao.mjs`
  // ao lado já tinha o `await`; este ficou para trás.
  return {
    nick: conta.nick,
    token: await assinarSessao({
      nick: conta.nick,
      contaId: Number(conta.id),
      provedor: conta.provedor,
    }),
  };
}

/** Fecha o pool. Sem isto o processo fica pendurado depois de terminar o trabalho. */
export const fecharBanco = () => pool.end();
