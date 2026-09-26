// Contas: senha própria, Google e Discord. Só quem tem sessão assinada entra no jogo.
//
// ### O que existia antes, e por que não bastava
//
// O jogo entrava com um NICK e nada mais. Isso é ótimo para experimentar (um campo, um clique,
// já se está caçando) e é péssimo assim que o progresso passa a valer alguma coisa: quem
// digitar o mesmo nick É aquele jogador. Com Mercado Global e ORBs lastreadas em USDT, um
// nick sem senha é uma carteira sem senha.
//
// ### Como a identidade se liga ao jogo
//
// O jogo inteiro roteia por NICK (`players.nick` é UNIQUE e é a chave do socket, do shard e
// da presença). Trocar isso por um id de conta seria reescrever o roteamento inteiro. Então a
// conta APONTA para o nick: `accounts.nick` é uma FK lógica para `players.nick`, e o resto do
// sistema continua sem saber que contas existem.
//
// ### WebSocket
//
// O `hello` do socket EXIGE o token assinado daqui — ver `gateway.mjs`. Sem conta e login,
// não há token, e não há jogo.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { pool, renomearJogador } from './db.mjs';
import { banDaConta, ehAdmin, renomearCargoChat } from './admin.mjs';
import { executarExclusaoConta } from './conta-excluir.mjs';
import { emailPermitidoCadastro } from '../shared/email-cadastro.mjs';
import { emailCanonico } from '../shared/email-canonico.mjs';

const scrypt = promisify(scryptCb);

// ------------------------------------------------------------------ config
//
// Tudo opcional: sem as chaves, o provedor simplesmente não aparece na tela de login. É o que
// permite rodar em dev sem configurar nada e ligar um provedor de cada vez em produção.

const env = process.env;

export const oauth = {
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
    autorizar: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    perfil: 'https://openidconnect.googleapis.com/v1/userinfo',
    escopo: 'openid email profile',
  },
  discord: {
    clientId: env.DISCORD_CLIENT_ID ?? '',
    clientSecret: env.DISCORD_CLIENT_SECRET ?? '',
    autorizar: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    perfil: 'https://discord.com/api/users/@me',
    escopo: 'identify email',
  },
};

/**
 * O endereço público do jogo. É com ele que se monta o `redirect_uri`, e ele PRECISA bater
 * caractere a caractere com o que estiver cadastrado no console do Google e do Discord —
 * divergir aqui é o erro nº 1 de OAuth ("redirect_uri_mismatch").
 */
export const URL_PUBLICA = (env.URL_PUBLICA ?? 'http://localhost:8080').replace(/\/$/, '');

/** Segredo que assina o token de sessão. Em produção é obrigatório vir do ambiente. */
const SEGREDO = env.AUTH_SEGREDO ?? '';
if (!SEGREDO && env.NODE_ENV === 'production') {
  console.error('[auth] AUTH_SEGREDO não definido — as sessões seriam assináveis por qualquer um.');
}
/** Em dev, um segredo efêmero: reiniciar o servidor derruba as sessões, o que é aceitável. */
const CHAVE = SEGREDO || randomBytes(32).toString('hex');

/** Quanto tempo uma sessão vale. 30 dias é o que se espera de um jogo que se abre todo dia. */
const SESSAO_MS = 30 * 24 * 60 * 60 * 1000;

// ------------------------------------------------------------- Turnstile
//
// Captcha do Cloudflare em /auth/entrar e /auth/criar — mesma ideia dos provedores OAuth
// acima: sem a chave configurada, a verificação nem roda, e o cliente nem desenha o widget.
export const turnstile = {
  siteKey: env.TURNSTILE_SITE_KEY ?? '',
  secretKey: env.TURNSTILE_SECRET_KEY ?? '',
};

export const provedoresAtivos = () => ({
  google: !!(oauth.google.clientId && oauth.google.clientSecret),
  discord: !!(oauth.discord.clientId && oauth.discord.clientSecret),
  // O cliente usa isto para esconder o nick no cadastro: com confirmação de e-mail, o nome
  // só é escolhido depois de confirmar e entrar — igual ao fluxo de Google/Discord.
  confirmacaoEmail: !!(env.RESEND_API_KEY ?? ''),
  // A SITE KEY não é segredo (ela vai no HTML) — só a SECRET fica no servidor. `null` faz o
  // cliente nem tentar desenhar o widget.
  turnstile: turnstile.siteKey || null,
});

/**
 * Confere com o Cloudflare se o token que o widget gerou é válido, antes de aceitar login ou
 * cadastro. Sem `TURNSTILE_SECRET_KEY`, devolve `true` direto — dev sem configurar nada
 * continua funcionando, e produção sem a chave se comporta como hoje (sem captcha nenhum).
 *
 * Falha de rede com o Cloudflare RECUSA (fail-closed), não deixa passar: é um controle de
 * segurança, e um captcha que aceita tudo quando o verificador está fora do ar não protege
 * nada bem na hora que mais importa. O rate limit de `passouDoLimite` continua valendo dos
 * dois jeitos, então uma instabilidade curta do Cloudflare não abre a porta para força bruta.
 */
export async function verificarTurnstile(token, ip) {
  if (!turnstile.secretKey) return true;
  if (!token) return false;
  try {
    const corpo = new URLSearchParams({ secret: turnstile.secretKey, response: String(token) });
    if (ip) corpo.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: corpo,
    });
    const d = await r.json();
    return !!d.success;
  } catch (err) {
    console.error('[turnstile] verificação falhou:', err.message);
    return false;
  }
}

/**
 * A coluna que impede uma caixa de e-mail de virar várias contas — valendo só DAQUI PARA A
 * FRENTE.
 *
 * `email_canon` guarda o endereço reduzido à caixa que ele realmente atinge (ver
 * `shared/email-canonico.mjs`). O índice é UNIQUE **parcial**, e é o `WHERE ... IS NOT NULL`
 * que faz toda a diferença desta migração:
 *
 * - **As contas que já existem ficam com `NULL`** e não entram no índice. Nenhuma delas é
 *   tocada, nenhuma colisão antiga precisa ser resolvida à mão, e a subida não pode falhar por
 *   causa de duplicata histórica — que é exatamente como um índice UNIQUE cheio quebraria o
 *   deploy, em produção, no boot.
 * - **Toda conta nova nasce com a chave preenchida** e passa a disputar unicidade entre si.
 *
 * O preço, dito com todas as letras: uma conta nova ainda consegue colidir com uma ANTIGA
 * (que tem `NULL` e não está no índice). É o resíduo aceito de não mexer no passado — e ele
 * encolhe sozinho conforme a base velha vai ficando minoria.
 *
 * Backfill fica de fora de propósito. Preencher as antigas exigiria decidir, para cada par que
 * colidisse, qual das contas sobrevive — e nenhuma dessas decisões é do código.
 */
async function canonizarEmailDaquiParaFrente() {
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_canon TEXT`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_email_canon ON accounts(email_canon)
       WHERE email_canon IS NOT NULL`,
  );
}

/**
 * A conta que já ocupa esta CAIXA de e-mail, ou `null`.
 *
 * Duas buscas, nesta ordem, e as duas importam: o endereço exato (que pega qualquer conta,
 * inclusive as antigas, sem `email_canon`) e depois a caixa canônica (que pega as novas mesmo
 * quando o endereço foi escrito com ponto ou `+apelido` diferente).
 */
async function contaNaMesmaCaixa(email) {
  const canon = emailCanonico(email);
  const { rows } = await pool.query(
    `SELECT * FROM accounts
      WHERE lower(email) = lower($1)
         OR ($2::text IS NOT NULL AND email_canon = $2)
      ORDER BY (lower(email) = lower($1)) DESC, id ASC
      LIMIT 1`,
    [String(email ?? ''), canon],
  );
  return rows[0] ?? null;
}

/**
 * Recusa se a caixa já for de OUTRA conta — no cadastro e nos três degraus da troca de e-mail
 * (pedido, autorização e confirmação, porque entre um e outro passa tempo suficiente para
 * alguém mais cadastrar o endereço).
 *
 * As duas mensagens não são detalhe: quem digitou EXATAMENTE o endereço que já cadastrou
 * precisa ler "já existe conta com esse e-mail" e ir recuperar a senha. Quem digitou uma
 * variante (ponto a mais, `+apelido`) leria isso e concluiria que a tela está quebrada — o
 * endereço, para ele, é outro. Esse é o único caso que merece a explicação da caixa.
 */
async function exigirCaixaLivre(email, contaId = null) {
  const dona = await contaNaMesmaCaixa(email);
  if (!dona || (contaId != null && Number(dona.id) === Number(contaId))) return;
  const exato = String(dona.email ?? '').toLowerCase() === String(email ?? '').toLowerCase();
  throw new ErroAuth(exato ? 'login.emailEmUso' : 'login.emailMesmaCaixa');
}

// ---------------------------------------------------------------- migração

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            BIGSERIAL PRIMARY KEY,
      -- O nick é a ponte para o jogo: tudo em players/player_pokemon continua roteando por ele.
      nick          TEXT NOT NULL UNIQUE,
      email         TEXT UNIQUE,
      -- NULL em conta de provedor: quem entra por Google não tem senha aqui, e não deve ter.
      senha_hash    TEXT,
      -- 'local' | 'google' | 'discord'
      provedor      TEXT NOT NULL DEFAULT 'local',
      provedor_id   TEXT,
      email_ok      BOOLEAN NOT NULL DEFAULT false,
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
      ultimo_login  TIMESTAMPTZ
    )`);
  // Quem entra por Google/Discord não escolheu nick nenhum: `nickLivre` inventou um a partir do
  // nome de lá ("Pedro Henrique" → "PedroHenrique"). Esta coluna marca isso, e é o que faz o
  // onboarding perguntar o nick ANTES de qualquer outra coisa para essa gente.
  //
  // O DEFAULT é `true` de propósito: contas que já existiam quando esta coluna nasceu já vinham
  // jogando com o nick delas, e perguntar de novo seria oferecer a troca de um nome que os
  // outros já conhecem.
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS nick_ok BOOLEAN NOT NULL DEFAULT true`);
  // Um provedor externo é identificado pelo par (provedor, id de lá) — o e-mail pode mudar.
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_provedor ON accounts(provedor, provedor_id)
       WHERE provedor_id IS NOT NULL`,
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_acc_email ON accounts(lower(email))`);
  await unicidadeSemCaixa();
  await canonizarEmailDaquiParaFrente();

  // Tokens de uso único: confirmação de e-mail e redefinição de senha usam a mesma tabela
  // porque têm exatamente a mesma forma (um segredo, um dono, um prazo, um uso).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_tokens (
      token       TEXT PRIMARY KEY,
      account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      tipo        TEXT NOT NULL,             -- 'email' | 'senha'
      expira_em   TIMESTAMPTZ NOT NULL,
      usado_em    TIMESTAMPTZ
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tok_conta ON account_tokens(account_id, tipo)`);
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_novo_pendente TEXT`);
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS senha_nova_pendente TEXT`);
  // A geração das sessões desta conta (ver "revogação de sessão" mais abaixo). Só cresce, e
  // toda sessão emitida com um número menor deixa de valer no ato.
  //
  // O DEFAULT é 0, e não `now()`, porque o contrário deslogaria o mundo inteiro no deploy
  // desta linha: os tokens que já estão por aí não têm época nenhuma gravada, e valem como 0.
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sessao_epoca BIGINT NOT NULL DEFAULT 0`);
}

// ------------------------------------------------------------------ senhas
//
// scrypt do próprio Node: sem dependência nova, e é uma KDF de memória alta — o que se quer
// contra GPU. Os parâmetros são os recomendados atuais (N=2^15); custam ~100 ms por hash, que
// é irrelevante num login e caro num ataque de dicionário.

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };

/**
 * O teto de memória do scrypt do Node é 32 MB por padrão, e N=2^15 com r=8 precisa de
 * 128·N·r = 33,5 MB — um byte acima do limite. Sem este `maxmem` explícito, TODO hash estoura
 * com `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` e nenhuma conta é criada.
 *
 * Baixar o N para caber nos 32 MB seria enfraquecer a KDF por causa de um valor padrão; o
 * caminho certo é levantar o teto, que é justamente o que ele existe para permitir.
 */
const MAXMEM = 64 * 1024 * 1024;

export async function hashSenha(senha) {
  const sal = randomBytes(16);
  const chave = await scrypt(senha, sal, SCRYPT.keylen, { ...SCRYPT, maxmem: MAXMEM });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sal.toString('base64')}$${chave.toString('base64')}`;
}

/**
 * Confere a senha em tempo CONSTANTE.
 *
 * `timingSafeEqual` e não `===`: comparar hash com `===` vaza, pelo tempo de resposta, quantos
 * bytes iniciais bateram. É um ataque incômodo de explorar pela rede, mas o custo de fazer
 * certo é uma linha.
 */
export async function conferirSenha(senha, guardado) {
  if (!guardado) return false;
  const [alg, N, r, p, sal, chave] = guardado.split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(chave, 'base64');
  const veio = await scrypt(senha, Buffer.from(sal, 'base64'), esperado.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: MAXMEM,
  });
  return veio.length === esperado.length && timingSafeEqual(veio, esperado);
}

/**
 * O nick passa a ser único IGNORANDO a caixa — no banco, não só no código.
 *
 * As checagens em JS (`nickDisponivel`, `nickLivre`) já comparam em minúsculas, mas checagem em
 * JS é corrida: duas requisições no mesmo instante passam as duas. Quem decide de verdade é o
 * índice, e o que existia (`nick TEXT UNIQUE`) era sensível a caixa — deixava `Daniel` entrar
 * ao lado de `daniel`, e como `carregarOuCriarJogador` casa por `lower(nick)`, as duas contas
 * apontavam para o mesmo personagem.
 *
 * ### Por que isto AVISA em vez de estourar
 *
 * Em `accounts` já existem 13 pares assim, criados pelo `nickLivre` antes do conserto. Enquanto
 * eles estiverem lá, o `CREATE UNIQUE INDEX` falha — e falhar aqui derrubaria o `migrar()`, ou
 * seja, o boot, ou seja, o jogo. Um endurecimento não pode ser a coisa que tira o servidor do
 * ar. Então tenta, e se não der, reclama alto e segue: os dois consertos de código
 * (`nickLivre` e `escolherNick`) já fecham o buraco sem depender deste índice, e ele passa a
 * existir sozinho no primeiro boot depois que os pares forem resolvidos à mão.
 *
 * `players` costuma passar de primeira: lá não há como criar duplicata por caixa, porque a
 * única porta de entrada (`carregarOuCriarJogador`) sempre procura por `lower(nick)` antes.
 */
async function unicidadeSemCaixa() {
  for (const [tabela, indice] of [['accounts', 'idx_acc_nick_min'], ['players', 'idx_players_nick_min']]) {
    try {
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${indice} ON ${tabela}(lower(nick))`);
    } catch (err) {
      const { rows } = await pool.query(
        `SELECT lower(nick) AS chave, string_agg(nick, ' | ' ORDER BY nick) AS variantes
           FROM ${tabela} GROUP BY lower(nick) HAVING count(*) > 1 ORDER BY 1`,
      ).catch(() => ({ rows: [] }));
      console.warn(
        `[auth] ${tabela}: nick ainda NÃO é único ignorando caixa (${err.code ?? err.message}). `
        + `${rows.length} par(es) a resolver à mão: ${rows.map((r) => r.variantes).join('; ') || '?'}`,
      );
    }
  }
}

// ------------------------------------------------------------------ sessão
//
// Um token curto e assinado, no formato `<payload base64url>.<hmac>`. Não é JWT de propósito:
// JWT traria uma dependência e um zoológico de algoritmos para carregar três campos.

const b64u = (b) => Buffer.from(b).toString('base64url');

// ------------------------------------------------------- revogação de sessão
//
// ### O problema que a época resolve
//
// Um token assinado é auto-suficiente por definição: quem o tem, entra, e o servidor não
// guarda nada sobre ele. Isso é ótimo para escalar (nenhuma consulta no caminho do login) e
// péssimo no dia em que a pessoa precisa EXPULSAR alguém. Antes disto, "sair" só apagava o
// `localStorage` do próprio navegador; o token copiado continuava valendo os 30 dias inteiros,
// e trocar a senha não derrubava ninguém. Num jogo com ORB lastreada em USDT, isso é a
// diferença entre "troquei a senha e resolvi" e "troquei a senha e o invasor continua dentro".
//
// ### Como funciona
//
// Cada conta tem uma ÉPOCA — um número que só cresce. O token carrega a época em que nasceu, e
// só vale enquanto os dois números baterem. Revogar tudo é uma única escrita: `sessao_epoca =
// agora`. Todos os tokens emitidos antes disso passam a não bater, de uma vez, sem tabela de
// sessões, sem lista negra e sem nada para limpar depois.
//
// ### Por que um cache, e o que custa
//
// A conferência é uma consulta por validação, e a validação roda no `hello` de cada socket.
// O cache de 60 s tira isso do caminho quente: numa reconexão em massa (deploy, queda de
// internet de uma operadora) são N sockets e UMA consulta por conta.
//
// O preço é uma JANELA: o processo que revoga atualiza o próprio cache na hora, mas os outros
// processos do cluster só percebem quando o TTL vira — até 60 s. Para "sair de todos os
// aparelhos" e para troca de senha, 60 s é aceitável e foi uma escolha, não um esquecimento:
// a alternativa (pub/sub no Redis) acrescenta um canal e um modo de falha novo para economizar
// menos de um minuto num evento raro. Se um dia isso importar, o gancho é `revogarSessoes`.
const EPOCA_TTL_MS = 60_000;
const epocas = new Map();

/** Limpa o que expirou — sem isto o mapa cresce com toda conta que já logou. */
setInterval(() => {
  const agora = Date.now();
  for (const [id, e] of epocas) if (agora > e.ate) epocas.delete(id);
}, EPOCA_TTL_MS).unref();

/** A época válida da conta agora, ou `null` se a conta não existe mais. */
async function epocaDaConta(contaId) {
  const id = Number(contaId);
  if (!Number.isFinite(id)) return null;
  const agora = Date.now();
  const guardado = epocas.get(id);
  if (guardado && agora < guardado.ate) return guardado.ep;

  const { rows } = await pool.query(`SELECT sessao_epoca FROM accounts WHERE id = $1`, [id]);
  // Conta apagada: devolver `null` faz toda sessão dela morrer, que é o certo. Não cacheamos
  // a ausência de propósito — é o caso raro, e cachear exigiria distinguir "não existe" de
  // "ainda não perguntei" dentro do mesmo mapa.
  if (!rows.length) return null;
  const ep = Number(rows[0].sessao_epoca ?? 0);
  epocas.set(id, { ep, ate: agora + EPOCA_TTL_MS });
  return ep;
}

/**
 * Derruba TODAS as sessões da conta. Devolve a época nova.
 *
 * Chame ANTES de assinar um token novo no mesmo fluxo (troca de senha devolve sessão): assinar
 * depois garante que o token recém-emitido nasce já com a época nova e sobrevive à revogação
 * que acabou de acontecer.
 */
export async function revogarSessoes(contaId) {
  const ep = Date.now();
  await pool.query(`UPDATE accounts SET sessao_epoca = $2 WHERE id = $1`, [contaId, ep]);
  epocas.set(Number(contaId), { ep, ate: Date.now() + EPOCA_TTL_MS });
  return ep;
}

/**
 * Assina uma sessão nova. É `async` porque precisa da época atual da conta.
 *
 * Ela é buscada aqui dentro, e não recebida por parâmetro, de propósito: um parâmetro a mais
 * é um lugar a mais para alguém esquecer de passar, e um token assinado com a época errada
 * nasce morto — o jogador levaria "sessão inválida" no login sem nada no log explicando.
 */
export async function assinarSessao({ nick, contaId, provedor }) {
  const ep = (await epocaDaConta(contaId)) ?? 0;
  const corpo = b64u(JSON.stringify({
    nick, contaId, provedor, ep, exp: Date.now() + SESSAO_MS,
  }));
  const mac = createHmac('sha256', CHAVE).update(corpo).digest('base64url');
  return `${corpo}.${mac}`;
}

/**
 * Vale a pena renovar este token agora?
 *
 * A sessão dura 30 dias contados da EMISSÃO. Sem renovar, quem joga todo santo dia é chutado
 * no trigésimo primeiro do mesmo jeito que quem sumiu — e num jogo idle, cair para a tela de
 * login sem motivo é exatamente o atrito que faz a pessoa não voltar.
 *
 * Renovando na metade do caminho, quem aparece pelo menos uma vez a cada 15 dias NUNCA vê a
 * tela de login de novo. E quem sumiu de verdade continua expirando: a janela de um token
 * roubado segue limitada, porque o relógio corre do mesmo jeito para ele.
 */
export const valeRenovar = (sessao) =>
  !!sessao?.exp && sessao.exp - Date.now() < SESSAO_MS / 2;

/** Renova mantendo a identidade do token atual. `null` se a sessão não vale mais. */
export async function renovarSessao(sessao) {
  if (!sessao?.contaId) return null;
  return assinarSessao({
    nick: sessao.nick,
    contaId: sessao.contaId,
    provedor: sessao.provedor,
  });
}

/** A conta ligada a um nick público — usada onde o nick precisa bater com um dono real. */
export async function contaPorNick(nick) {
  const { rows } = await pool.query(
    `SELECT id, nick, email, provedor, email_ok, nick_ok, senha_hash IS NOT NULL AS tem_senha
       FROM accounts WHERE lower(nick) = lower($1) LIMIT 1`,
    [nick],
  );
  return rows[0] ?? null;
}

/**
 * A parte OFFLINE da conferência: assinatura e prazo. Não sabe de revogação.
 *
 * Privada de propósito. Quem exporta é a `lerSessao` abaixo, que é a que confere a época —
 * deixar as duas exportadas seria oferecer, do lado de fora, a versão que esquece de checar
 * se a sessão foi derrubada.
 */
function lerSessaoAssinada(token) {
  const [corpo, mac] = String(token ?? '').split('.');
  if (!corpo || !mac) return null;
  const certo = createHmac('sha256', CHAVE).update(corpo).digest('base64url');
  // Comprimentos diferentes fariam `timingSafeEqual` ESTOURAR, não devolver false.
  if (mac.length !== certo.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(certo))) return null;
  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return dados.exp > Date.now() ? dados : null;
  } catch {
    return null;
  }
}

/**
 * Devolve o conteúdo do token, ou `null` — assinatura, prazo E revogação.
 *
 * ### Por que virou `async`
 *
 * A conferência da época precisa do banco (com cache de 60 s à frente, ver acima). Todos os
 * pontos de chamada já estavam dentro de função `async`, então o custo foi um `await` em
 * cada um.
 *
 * E o modo de falha de ESQUECER um `await` é o seguro: sem ele, a variável recebe uma Promise,
 * `sessao.contaId` fica `undefined` e todo `if (!sessao?.contaId) return 401` do código barra a
 * requisição. Um `await` perdido tranca a porta em vez de abri-la.
 *
 * ### Token sem época
 *
 * Os tokens emitidos antes desta mudança não têm o campo `ep`. Eles valem enquanto a conta
 * nunca revogou nada (época 0), e morrem no instante em que ela revoga — que é exatamente o
 * comportamento desejado. Ninguém é deslogado pela migração em si.
 */
export async function lerSessao(token) {
  const dados = lerSessaoAssinada(token);
  if (!dados?.contaId) return dados;
  const epoca = await epocaDaConta(dados.contaId);
  if (epoca === null) return null;         // conta apagada
  if (Number(dados.ep ?? 0) !== epoca) return null;  // derrubada por revogação
  return dados;
}

// ------------------------------------------------------------------ contas

const NICK_OK = /^[a-zA-Z0-9_]{3,16}$/;
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Erro com uma CHAVE de i18n em vez de texto — quem traduz é o cliente.
 *
 * `extra` é o que a TELA precisa junto da chave e que só o servidor sabe. Hoje é o motivo do
 * ban, e ele anda separado da chave de propósito: a chave é traduzida nos três idiomas, e o
 * motivo é texto livre que a moderação escreveu à mão — traduzir um não pode implicar inventar
 * o outro. Fica num campo próprio (e não espalhado no erro) para não haver como sobrescrever
 * `message` ou `stack` sem querer.
 */
class ErroAuth extends Error {
  constructor(chave, extra = null) {
    super(chave);
    this.chave = chave;
    this.extra = extra;
  }
}

/**
 * O ban virando erro de login, COM o motivo.
 *
 * Sem isto o jogador banido lia "Conta banida — você não pode entrar no jogo." e mais nada: a
 * moderação escrevia a razão no painel, gravava no banco, e ela morria ali. Quem levou ban por
 * multi-conta não tinha como saber nem que era multi-conta, nem para qual conta a moeda dele
 * foi — e o suporte respondia à mão o que a tela já poderia ter dito.
 *
 * Os três caminhos de entrada passam por aqui (senha, Google e Discord), porque os três
 * chamam `banDaConta` e os três jogavam o motivo fora do mesmo jeito.
 */
const erroDeBan = (ban) => new ErroAuth('login.contaBanida', {
  motivoBan: ban?.motivo ? String(ban.motivo).slice(0, 500) : null,
});

/** Só domínios de `email-cadastro.mjs` — cadastro, login e OAuth. */
function exigirEmailPermitido(email) {
  if (!emailPermitidoCadastro(email)) throw new ErroAuth('login.emailDominio');
}

/**
 * Cria uma conta local.
 *
 * O `players` NÃO é criado aqui. Quem cria o jogador continua sendo o login no jogo
 * (`carregarOuCriarJogador`, no primeiro `hello`), e é isso que faz uma conta nova cair no
 * mesmo caminho de um convidado — inclusive na escolha do starter.
 *
 * Quem já jogava de convidado com aquele nick e depois cria a conta com o MESMO nick fica com
 * o progresso: a conta só carimba dono num `players` que já existe.
 *
 * Com confirmação de e-mail ligada (`resend.ativo()`), o nick público NÃO é gravado aqui: nasce
 * um placeholder interno e `nick_ok = false`, e a pessoa escolhe o nome depois de confirmar a
 * caixa e entrar — o mesmo caminho de quem veio por Google/Discord. Sem isso, alguém podia
 * reservar dezenas de nicks sem confirmar nenhum e-mail.
 */
export async function criarConta({ nick, email, senha }) {
  if (!EMAIL_OK.test(email ?? '')) throw new ErroAuth('login.emailInvalido');
  if (!emailPermitidoCadastro(email)) throw new ErroAuth('login.emailDominio');
  if ((senha ?? '').length < 8) throw new ErroAuth('login.senhaCurta');

  const hash = await hashSenha(senha);
  const emailNorm = email.toLowerCase();
  const canon = emailCanonico(emailNorm);

  // A checagem ANTES do INSERT existe pela MENSAGEM, não pela trava — quem garante unicidade é
  // o índice, e só ele aguenta duas requisições ao mesmo tempo. Aqui se ganha o direito de
  // distinguir "você já tem conta com esse e-mail" de "esse endereço cai na mesma caixa de uma
  // conta que já existe", que é a diferença entre a pessoa ir recuperar a senha e a pessoa
  // achar que a tela quebrou.
  await exigirCaixaLivre(emailNorm);

  if (resend.ativo()) {
    const nickProvisorio = await nickLivre(emailNorm.split('@')[0] || 'treinador');
    try {
      const { rows } = await pool.query(
        `INSERT INTO accounts (nick, email, email_canon, senha_hash, provedor, nick_ok, ultimo_login)
         VALUES ($1, $2, $3, $4, 'local', false, now()) RETURNING *`,
        [nickProvisorio, emailNorm, canon, hash],
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') throw new ErroAuth(chaveDeColisao(err));
      throw err;
    }
  }

  if (!NICK_OK.test(nick ?? '')) throw new ErroAuth('login.nickInvalido');
  try {
    // `RETURNING *` e não a lista curta que estava aqui: sem o `email` de volta,
    // `mandarConfirmacao` caía no `if (!conta.email) return false` e o e-mail de confirmação
    // NUNCA saía — em silêncio, porque o envio é disparado sem `await` e o erro é engolido.
    // Enquanto criar conta entrava direto no jogo, ninguém percebia; agora a confirmação é a
    // porta, e um e-mail que não sai tranca o jogador do lado de fora.
    const { rows } = await pool.query(
      `INSERT INTO accounts (nick, email, email_canon, senha_hash, provedor, ultimo_login)
       VALUES ($1, $2, $3, $4, 'local', now()) RETURNING *`,
      [nick, emailNorm, canon, hash],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new ErroAuth(chaveDeColisao(err));
    throw err;
  }
}

/**
 * Qual das unicidades de `accounts` estourou — 23505 é `unique_violation`.
 *
 * A mensagem diz QUAL das três colidiu porque "já existe" sem dizer o quê manda a pessoa
 * adivinhar entre trocar o nick, recuperar a senha e tentar outro endereço. O índice da caixa
 * canônica vem PRIMEIRO no teste: o nome dele também contém "email", então checá-lo depois o
 * faria cair no ramo genérico e o jogador leria "e-mail em uso" para um endereço que ele
 * nunca cadastrou.
 */
const chaveDeColisao = (err) => {
  const c = err.constraint ?? '';
  if (c.includes('canon')) return 'login.emailMesmaCaixa';
  if (c.includes('email')) return 'login.emailEmUso';
  return 'login.nickEmUso';
};

/**
 * Entra com nick OU e-mail + senha.
 *
 * Conta local com e-mail ainda não confirmado NÃO entra. A checagem vem DEPOIS da senha de
 * propósito: recusar antes diria "esta conta existe e está pendente" a quem só chutou um nick.
 *
 * A trava só existe quando há como confirmar (`resend.ativo()`). Sem chave de e-mail
 * configurada, exigir confirmação trancaria todo mundo do lado de fora para sempre — em
 * ambiente de desenvolvimento isso é o jogo inteiro inacessível.
 */
export async function entrarComSenha({ id, senha }) {
  const { rows } = await pool.query(
    `SELECT * FROM accounts WHERE nick = $1 OR lower(email) = lower($1)`,
    [String(id ?? '').trim()],
  );
  const conta = rows[0];
  // A MESMA mensagem para "conta não existe" e "senha errada": distinguir as duas entrega de
  // graça a lista de quem tem conta aqui.
  if (!conta || !(await conferirSenha(senha, conta.senha_hash))) {
    throw new ErroAuth('login.credenciaisInvalidas');
  }
  if (conta.email) exigirEmailPermitido(conta.email);
  if (!conta.email_ok && conta.provedor === 'local' && resend.ativo()) {
    throw new ErroAuth('login.confirmeEmail');
  }
  const ban = await banDaConta(conta.id);
  if (ban) throw erroDeBan(ban);
  await pool.query(`UPDATE accounts SET ultimo_login = now() WHERE id = $1`, [conta.id]);
  return conta;
}

// ------------------------------------------------------------------- o nick
//
// O nick é a chave do jogo inteiro (`players.nick` é UNIQUE e roteia socket, shard e presença),
// então ele é único nas DUAS tabelas: `accounts` (quem tem conta) e `players` (quem já jogou).
// Conferir só uma delas deixaria alguém escolher um nick que o `hello` depois recusaria.

/**
 * O nick está livre?
 * `contaId` ignora a própria conta; `playerId` ignora o próprio personagem (troca de nome).
 */
export async function nickDisponivel(nick, contaId = null, playerId = null) {
  if (!NICK_OK.test(nick ?? '')) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM accounts
      WHERE lower(nick) = lower($1) AND ($2::bigint IS NULL OR id <> $2)
        -- Placeholder de cadastro local sem confirmar: não reserva nome público.
        AND NOT (nick_ok = false AND email_ok = false AND provedor = 'local')
     UNION ALL
     SELECT 1 FROM players
      WHERE lower(nick) = lower($1) AND ($3::bigint IS NULL OR id <> $3)`,
    [nick, contaId, playerId],
  );
  return !rows.length;
}

/**
 * Grava o nick que o jogador escolheu no onboarding e fecha a pergunta.
 *
 * Só vale enquanto `nick_ok` é falso — ou seja, uma vez, para quem entrou por provedor ou
 * criou conta local com confirmação de e-mail. Depois
 * disso trocar de nome é o produto pago da loja, e deixar esta rota aberta daria de graça o
 * que lá custa 6 ORBs.
 *
 * A corrida entre a checagem e o UPDATE é resolvida pelo índice UNIQUE, não por trava: dois
 * jogadores mirando o mesmo nick no mesmo instante fazem o segundo receber 23505 aqui.
 */
export async function escolherNick(contaId, nick) {
  if (!NICK_OK.test(nick ?? '')) throw new ErroAuth('login.nickInvalido');
  const { rows: atual } = await pool.query(`SELECT nick, nick_ok FROM accounts WHERE id = $1`, [contaId]);
  if (!atual[0]) throw new ErroAuth('login.falhou');
  if (atual[0].nick_ok) throw new ErroAuth('conta.nickJaEscolhido');
  if (!(await nickDisponivel(nick, contaId))) throw new ErroAuth('login.nickEmUso');

  const nickAntigo = atual[0].nick;
  // Comparação EXATA, e essa mudança fecha uma tomada de conta.
  //
  // Era `lower(nick) = lower($1)`, sem conferir de quem é o personagem — e `players` não tem
  // coluna de dono: o vínculo com a conta É o nick. Onde existiam duas contas diferindo só na
  // caixa (13 pares em produção, ver `nickLivre`), este SELECT achava o personagem da OUTRA
  // conta, e o `renomearJogador` logo abaixo o entregava para quem estava escolhendo o nick.
  // O dono original ficava com uma conta apontando para nick nenhum e reencontrava um
  // personagem vazio no login seguinte.
  //
  // Exata resolve sem quebrar o caso legítimo: quando ESTA conta chegou a jogar com o nick
  // provisório, a linha em `players` nasceu com esse nick idêntico (`carregarOuCriarJogador`
  // insere o que recebeu). Quando o que existe é o personagem de outro, a caixa difere, não
  // casa, e a conta segue para o `UPDATE` de baixo — que é o certo: aquele personagem não é
  // dela.
  const { rows: jog } = await pool.query(
    `SELECT id FROM players WHERE nick = $1`,
    [nickAntigo],
  );

  try {
    // Quem entrou no jogo com o nick provisório (antes de confirmar o definitivo) grava o
    // progresso em `players` sob aquele nome. Só atualizar `accounts.nick` deixava o personagem
    // órfão — `/diamantes/comprar` olhava o nick novo e não achava linha, e um F5 abria um
    // personagem vazio com o nome certo.
    if (jog[0]) {
      await renomearJogador(jog[0].id, nick, contaId);
      await renomearCargoChat(nickAntigo, nick);
      await pool.query(`UPDATE accounts SET nick_ok = true WHERE id = $1`, [contaId]);
      const { rows } = await pool.query(`SELECT * FROM accounts WHERE id = $1`, [contaId]);
      return rows[0];
    }
    const { rows } = await pool.query(
      `UPDATE accounts SET nick = $2, nick_ok = true WHERE id = $1 RETURNING *`,
      [contaId, nick],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new ErroAuth('login.nickEmUso');
    throw err;
  }
}

/**
 * Acha (ou cria) a conta de um provedor externo.
 *
 * A ordem de busca importa: primeiro pelo par (provedor, id), que é estável; só depois pelo
 * e-mail, que serve para LIGAR um login de Google a uma conta local que já usava aquele
 * e-mail. Sem esse segundo passo, quem criou conta com senha e depois clicou em "Continuar com
 * Google" ganharia uma segunda conta e perderia o personagem.
 *
 * `emailConfirmado` é o que autoriza esse segundo passo, e não é opcional na prática: ligar
 * pelo e-mail é ENTRAR numa conta que já existe, ou seja, o endereço está sendo usado como
 * credencial. Quem chamar sem provar que o provedor confirmou o endereço recebe uma conta nova,
 * nunca a de outra pessoa. Ver o comentário longo no retorno do OAuth (`auth-rotas.mjs`).
 *
 * NÃO se exige que a conta EXISTENTE tenha `email_ok`: o caso comum é justamente o contrário —
 * alguém criou conta local com um endereço que nunca confirmou, e o dono de verdade daquele
 * e-mail chega pelo Google. Aí passar a conta para quem provou o endereço é o desfecho certo.
 */
export async function entrarComProvedor({
  provedor, provedorId, email, emailConfirmado = false, nomeSugerido, antesDeCriar,
}) {
  const { rows: porId } = await pool.query(
    `SELECT * FROM accounts WHERE provedor = $1 AND provedor_id = $2`,
    [provedor, String(provedorId)],
  );
  if (porId[0]) {
    if (porId[0].email) exigirEmailPermitido(porId[0].email);
    const ban = await banDaConta(porId[0].id);
    if (ban) throw erroDeBan(ban);
    await pool.query(`UPDATE accounts SET ultimo_login = now() WHERE id = $1`, [porId[0].id]);
    return porId[0];
  }

  // A busca é pela CAIXA, não pelo endereço exato — e isso é o que mantém o login com Google
  // funcionando depois da canonização. Quem criou conta local como `pedro+jogo@gmail.com` e um
  // dia clica em "Continuar com Google" chega aqui com `pedro@gmail.com`: pelo endereço exato
  // não casaria nada, o código seguiria para o INSERT lá embaixo e bateria no índice único da
  // caixa — 23505 no meio de um fluxo OAuth, que o jogador lê como "login falhou", sem saída.
  // Casando pela caixa, o que acontece é o certo e o que ele espera: a conta que já existe é
  // LIGADA ao provedor, com o personagem dele dentro.
  if (email && emailConfirmado) {
    const naCaixa = await contaNaMesmaCaixa(email);
    if (naCaixa) {
      if (naCaixa.email) exigirEmailPermitido(naCaixa.email);
      const ban = await banDaConta(naCaixa.id);
      if (ban) throw erroDeBan(ban);
      await pool.query(
        `UPDATE accounts SET provedor = $2, provedor_id = $3, email_ok = true, ultimo_login = now()
          WHERE id = $1`,
        [naCaixa.id, provedor, String(provedorId)],
      );
      return { ...naCaixa, provedor, provedor_id: String(provedorId) };
    }
  }

  exigirEmailPermitido(email);

  // O último ponto em que ainda dá para recusar SEM recusar um login.
  //
  // É aqui, e não no começo da função, porque tudo acima é ENTRAR numa conta que já existe — e
  // o teto de contas por IP não pode nunca trancar quem já tem conta do lado de fora dela. Da
  // linha abaixo em diante é cadastro novo, e cadastro novo é o que o teto governa. Quem passa
  // o gancho é `auth-rotas.mjs`; sem ele, nada muda.
  if (antesDeCriar) await antesDeCriar();

  // Conta nova. O e-mail do provedor já vem verificado por ele, então `email_ok` nasce true —
  // é por isso que quem entra por Google/Discord não passa pela confirmação de e-mail.
  //
  // `nick_ok` nasce FALSE: o nick aqui é um chute a partir do nome do provedor, e o onboarding
  // vai perguntar qual o jogador quer de verdade antes de qualquer outra coisa.
  const nick = await nickLivre(nomeSugerido || `treinador${String(provedorId).slice(-4)}`);
  const { rows } = await pool.query(
    `INSERT INTO accounts (nick, email, email_canon, provedor, provedor_id, email_ok, nick_ok, ultimo_login)
     VALUES ($1, $2, $3, $4, $5, true, false, now()) RETURNING *`,
    [nick, email?.toLowerCase() ?? null, emailCanonico(email), provedor, String(provedorId)],
  );
  return rows[0];
}

/**
 * Um nick livre a partir de uma sugestão do provedor.
 *
 * O nome que vem do Google ("Pedro Henrique") não passa no formato do jogo, e o nick é UNIQUE
 * em duas tabelas. Limpa-se o que dá e, se bater, vai numerando — em vez de recusar o login de
 * alguém por causa do nome que ele tem.
 */
async function nickLivre(sugestao) {
  const base = String(sugestao).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12) || 'treinador';
  const nome = base.length >= 3 ? base : `${base}___`.slice(0, 3);
  for (let i = 0; i < 50; i++) {
    const tentativa = i ? `${nome}${i}`.slice(0, 16) : nome;
    // `lower(...)` nos DOIS lados, e é o conserto de um estrago real: com a comparação
    // sensível a caixa que estava aqui, um login de Google cujo nome virasse "Daniel" não
    // enxergava o "daniel" que já existia e criava a conta assim mesmo. Foram 13 pares em
    // produção — e o `UNIQUE` do banco também é sensível a caixa, então nada barrava.
    //
    // O par não é só feio: `carregarOuCriarJogador` casa por `lower(nick)`, então as DUAS
    // contas apontam para o MESMO personagem.
    const { rows } = await pool.query(
      `SELECT 1 FROM accounts WHERE lower(nick) = lower($1)
       UNION ALL
       SELECT 1 FROM players  WHERE lower(nick) = lower($1)`,
      [tentativa],
    );
    if (!rows.length) return tentativa;
  }
  return `treinador${Date.now() % 1000000}`;
}

// ------------------------------------------------------- confirmação de e-mail
//
// ### Estado: PRONTO PARA LIGAR, desligado por padrão
//
// Falta só a chave do Resend (`RESEND_API_KEY`) e o remetente (`RESEND_DE`). Sem elas, criar
// conta funciona igual e o e-mail simplesmente não sai — o jogo não trava esperando um
// serviço que ainda não foi contratado.
//
// Confirmar e-mail NÃO bloqueia o jogo, e isso é decisão de produto: quem acabou de criar a
// conta entra e joga na hora. A confirmação existe para recuperar senha e para provar que o
// e-mail é de quem diz ser antes de qualquer saque de ORB.

export const resend = {
  chave: env.RESEND_API_KEY ?? '',
  de: env.RESEND_DE ?? 'Pokéidle <nao-responda@pokeidle.io>',
  ativo() {
    return !!this.chave;
  },
};

/** Gera (e guarda) um token de uso único. */
export async function criarToken(contaId, tipo, horas = 24) {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO account_tokens (token, account_id, tipo, expira_em)
     VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
    [token, contaId, tipo, String(horas)],
  );
  return token;
}

/** Queima um token e devolve a conta dele. `null` se não existe, já foi usado ou venceu. */
export async function usarToken(token, tipo) {
  const { rows } = await pool.query(
    `UPDATE account_tokens SET usado_em = now()
      WHERE token = $1 AND tipo = $2 AND usado_em IS NULL AND expira_em > now()
      RETURNING account_id`,
    [token, tipo],
  );
  return rows[0] ? Number(rows[0].account_id) : null;
}

/**
 * Manda um e-mail pelo Resend.
 *
 * Falhar aqui NUNCA derruba a ação que pediu o e-mail: se o Resend estiver fora do ar, criar
 * conta continua funcionando e o jogador pode pedir o e-mail de novo depois. Por isso o erro é
 * registrado e engolido.
 */
export async function enviarEmail({ para, assunto, html, de, lancarErro = false, headers, text }) {
  if (!resend.ativo()) {
    if (lancarErro) throw new Error('Resend não configurado (RESEND_API_KEY)');
    return false;
  }
  try {
    const corpo = { from: de ?? resend.de, to: [para], subject: assunto, html };
    if (text) corpo.text = text;
    if (headers) corpo.headers = headers;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${resend.chave}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return true;
  } catch (err) {
    console.error('[auth] Resend falhou:', err.message);
    if (lancarErro) throw err;
    return false;
  }
}

// ------------------------------------------------------------- os e-mails
//
// HTML de e-mail é outro planeta: nada de flexbox, grid ou `<style>` — Gmail e Outlook
// descartam a folha e desmontam o layout. Por isso é TABELA e estilo inline, que é o que
// atravessa os clientes todos. As cores são as da casa (madeira, vão escuro, roxo e o dourado
// do botão), para o e-mail parecer do mesmo jogo de onde saiu.

const CORES = {
  fundo: '#241722', vao: '#33202b', vao2: '#462b39',
  mad: '#bd6951', madLinha: '#480e1e', madBase: '#722c3f',
  texto: '#fff6ef', textoFraco: '#c9a9b4',
  ouro: '#fccb0f', ouroEsc: '#e8a800', ouroTexto: '#4a3608',
};

/**
 * A moldura comum dos e-mails: cabeçalho de madeira com a marca, corpo escuro, rodapé.
 * `botao` é opcional — o de confirmação e o de senha usam, um aviso simples não usaria.
 */
export function moldarEmail({ titulo, corpo, botao, link, rodape }) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title></head>
<body style="margin:0;padding:0;background:${CORES.fundo};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${CORES.fundo};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:520px;border-radius:10px;overflow:hidden;
                  border:2px solid ${CORES.madLinha};background:${CORES.vao};">
      <tr>
        <td align="center" style="background:${CORES.mad};border-bottom:4px solid ${CORES.madBase};padding:18px 20px;">
          <span style="font-family:Tahoma,Verdana,sans-serif;font-size:26px;font-weight:bold;
                       letter-spacing:1px;color:${CORES.ouro};
                       text-shadow:0 2px 0 ${CORES.madBase};">Pokéidle.io</span>
        </td>
      </tr>
      <tr>
        <td style="padding:26px 26px 8px;font-family:Verdana,Geneva,sans-serif;color:${CORES.texto};">
          <h1 style="margin:0 0 14px;font-size:18px;color:${CORES.texto};">${titulo}</h1>
          ${corpo}
        </td>
      </tr>
      ${botao ? `
      <tr><td align="center" style="padding:8px 26px 22px;">
        <a href="${link}" style="display:inline-block;background:${CORES.ouro};
           background-image:linear-gradient(180deg,#ffe07a,${CORES.ouroEsc});
           color:${CORES.ouroTexto};font-family:Tahoma,Verdana,sans-serif;font-weight:bold;
           font-size:15px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;
           padding:14px 30px;border-radius:7px;border:2px solid ${CORES.madLinha};">${botao}</a>
      </td></tr>
      <tr><td style="padding:0 26px 20px;font-family:Verdana,sans-serif;font-size:11px;
                     color:${CORES.textoFraco};word-break:break-all;">
        Se o botão não abrir, copie e cole este endereço:<br>
        <a href="${link}" style="color:#7fd4ff;">${link}</a>
      </td></tr>` : ''}
      <tr>
        <td style="background:${CORES.vao2};border-top:2px solid ${CORES.madLinha};
                   padding:14px 26px;font-family:Verdana,sans-serif;font-size:11px;
                   color:${CORES.textoFraco};line-height:1.6;">
          ${rodape}
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** O nome de marca do provedor, para o e-mail falar como a pessoa fala. */
const NOME_PROVEDOR = { google: 'Google', discord: 'Discord', local: 'e-mail e senha' };

export async function mandarConfirmacao(conta) {
  if (!conta.email || !resend.ativo()) return false;
  const token = await criarToken(conta.id, 'email');
  const link = `${URL_PUBLICA}/auth/confirmar?token=${token}`;
  return enviarEmail({
    para: conta.email,
    assunto: 'Confirme seu e-mail — Pokéidle.io',
    html: moldarEmail({
      titulo: conta.nick_ok ? `Bem-vindo, ${conta.nick}!` : 'Bem-vindo ao Pokéidle.io!',
      corpo: `<p style="margin:0 0 12px;line-height:1.7;font-size:14px;">
                Sua conta está criada. Confirme seu e-mail para entrar e escolher seu nome
                de treinador — e para conseguir recuperar a senha depois, caso precise.</p>`,
      botao: 'Confirmar e-mail',
      link,
      rodape: `O link vale por <b>24 horas</b>.<br>
               Se não foi você quem criou esta conta, é só ignorar este e-mail.`,
    }),
  });
}

/**
 * Manda o link de redefinição de senha.
 *
 * O link cai no jogo em `/app?redefinir=<token>` — a landing (`/`) não lê esse parâmetro.
 *
 * Prazo curto (1 hora, contra as 24 da confirmação): um link que troca senha vale muito mais
 * na mão errada do que um que confirma e-mail.
 */
export async function mandarRedefinicao(conta) {
  if (!conta.email || !resend.ativo()) return false;
  const token = await criarToken(conta.id, 'senha', 1);
  const link = `${URL_PUBLICA}/app?redefinir=${token}`;
  return enviarEmail({
    para: conta.email,
    assunto: 'Trocar a senha — Pokéidle.io',
    html: moldarEmail({
      titulo: 'Trocar a sua senha',
      corpo: `<p style="margin:0 0 12px;line-height:1.7;font-size:14px;">
                Alguém (esperamos que você) pediu para trocar a senha da conta
                <b style="color:${CORES.ouro};">${conta.nick}</b>.</p>
              <p style="margin:0;line-height:1.7;font-size:14px;">
                Clique no botão para escolher uma senha nova.</p>`,
      botao: 'Escolher nova senha',
      link,
      rodape: `O link vale por <b>1 hora</b> e só pode ser usado uma vez.<br>
               Se não foi você, ignore este e-mail — <b>sua senha continua a mesma</b>.`,
    }),
  });
}

/**
 * Avisa, por e-mail, que a conta não tem senha nossa para trocar.
 *
 * Quem entrou por Google ou Discord e depois clica em "Esqueci minha senha" cairia num beco:
 * a tela não pode dizer "essa conta é do Google" (isso seria confirmar, para um estranho, que
 * o endereço tem conta aqui), então quem diz é o e-mail — que só chega em quem é dono da caixa.
 * Sem isto, o pedido some no silêncio e a pessoa acha que o jogo está quebrado.
 */
export async function mandarAvisoDeProvedor(conta) {
  if (!conta.email || !resend.ativo()) return false;
  const nome = NOME_PROVEDOR[conta.provedor] ?? conta.provedor;
  return enviarEmail({
    para: conta.email,
    assunto: 'Como entrar na sua conta — Pokéidle.io',
    html: moldarEmail({
      titulo: 'Sua conta não usa senha',
      corpo: `<p style="margin:0 0 12px;line-height:1.7;font-size:14px;">
                Alguém pediu para trocar a senha da conta
                <b style="color:${CORES.ouro};">${conta.nick}</b>, mas ela entra pelo
                <b style="color:${CORES.ouro};">${nome}</b> — não existe senha nossa para trocar.</p>
              <p style="margin:0;line-height:1.7;font-size:14px;">
                Na tela de entrar, use o botão <b>${nome}</b>. Se a senha que você esqueceu
                for a do ${nome}, a troca é feita lá.</p>`,
      rodape: `Se não foi você, ignore este e-mail — <b>nada mudou na sua conta</b>.`,
    }),
  });
}

// -------------------------------------------------------- trocar a senha

/**
 * A conta de um login — nick ou e-mail no mesmo campo, como na tela de entrar.
 *
 * Devolve a linha INTEIRA (hash incluso), então é para uso interno do servidor: nada daqui
 * vai para a resposta sem ser escolhido campo a campo.
 */
export async function contaPorEmailOuNick(id) {
  const chave = String(id ?? '').trim();
  if (!chave) return null;
  const { rows } = await pool.query(
    `SELECT * FROM accounts WHERE nick = $1 OR lower(email) = lower($1)`,
    [chave],
  );
  return rows[0] ?? null;
}

/**
 * A conta de um e-mail. SÓ e-mail — e a diferença para a de cima é de segurança, não de gosto.
 *
 * O nick é público: sai no ranking, no chat, na guild, na ficha de qualquer treinador. O
 * e-mail não sai em lugar nenhum. Uma recuperação que aceitasse nick deixaria qualquer um
 * disparar e-mail na caixa de quem ele vê no ranking, sem nunca ter sabido o endereço — nós
 * assinando o spam. Exigir o e-mail obriga o atacante a já ter aquilo que ele queria alcançar.
 *
 * Onde a senha também é pedida (entrar, reenviar confirmação) o nick continua valendo: lá a
 * credencial é que segura a porta, e o campo é só o nome de quem está batendo.
 */
export async function contaPorEmail(email) {
  const chave = String(email ?? '').trim();
  if (!chave.includes('@')) return null;
  const { rows } = await pool.query(`SELECT * FROM accounts WHERE lower(email) = lower($1)`, [chave]);
  return rows[0] ?? null;
}

/** A conta de um id, sem o hash da senha — é o que vai para a tela. */
export async function contaPorId(id) {
  const { rows } = await pool.query(
    `SELECT id, nick, email, provedor, email_ok, nick_ok, senha_hash IS NOT NULL AS tem_senha
       FROM accounts WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Quando o próximo pedido de troca de senha libera, em ms — ou 0 se já pode.
 *
 * O limite é de UM por hora, por conta, e sai de graça do que já existe: um token de senha vale
 * exatamente 1 hora, então "existe token de senha vivo" É "pediu na última hora". Não precisa
 * de coluna nova nem de balde em memória, e sobrevive a restart do servidor — que é o que um
 * balde em memória não faz.
 *
 * Trocar a senha de fato queima os tokens pendentes (`trocarSenha`), então quem completou a
 * troca não fica preso pelo resto da hora.
 */
export async function esperaParaTrocarSenha(contaId) {
  const { rows } = await pool.query(
    `SELECT max(expira_em) AS ate FROM account_tokens
      WHERE account_id = $1 AND tipo = 'senha' AND usado_em IS NULL AND expira_em > now()`,
    [contaId],
  );
  const ate = rows[0]?.ate;
  return ate ? Math.max(0, new Date(ate).getTime() - Date.now()) : 0;
}

/**
 * Grava a senha nova e QUEIMA os outros pedidos pendentes.
 *
 * Invalidar os tokens que sobraram é o que impede um link antigo (de um pedido anterior, ou
 * de um e-mail que vazou) de continuar valendo depois que a senha já foi trocada.
 */
export async function trocarSenha(contaId, senha) {
  if ((senha ?? '').length < 8) throw new ErroAuth('login.senhaCurta');
  const hash = await hashSenha(senha);
  await pool.query(`UPDATE accounts SET senha_hash = $2 WHERE id = $1`, [contaId, hash]);
  await pool.query(
    `UPDATE account_tokens SET usado_em = now()
      WHERE account_id = $1 AND tipo = 'senha' AND usado_em IS NULL`,
    [contaId],
  );
  // Trocar a senha DERRUBA todas as sessões — é o motivo nº 1 pelo qual alguém troca a senha.
  // Sem isto, quem tomou a conta continuava dentro pelos 30 dias do token que já tinha, e a
  // troca de senha só servia para impedir um segundo login. Vem DEPOIS do UPDATE do hash e
  // ANTES de qualquer `assinarSessao` do fluxo, para o token novo já nascer com a época nova.
  await revogarSessoes(contaId);
}

// -------------------------------------------------------- trocar o e-mail

async function contaCompletaPorId(id) {
  const { rows } = await pool.query(`SELECT * FROM accounts WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Quanto falta para o próximo pedido de troca de e-mail (passo 1).
 *
 * O limite é de UM pedir por hora, por CONTA — amarrado ao token do passo 1, mesmo depois
 * de usado ou de a troca ter sido concluída. Só tokens `email_troca_pedido` contam: é neles
 * que nasce o relógio de 1 h quando alguém clica em "Trocar e-mail".
 */
export async function esperaParaTrocarEmail(contaId) {
  const { rows } = await pool.query(
    `SELECT max(expira_em) AS ate FROM account_tokens
      WHERE account_id = $1 AND tipo = 'email_troca_pedido'
        AND expira_em > now()`,
    [contaId],
  );
  const ate = rows[0]?.ate;
  return ate ? Math.max(0, new Date(ate).getTime() - Date.now()) : 0;
}

/** Lê um token válido sem queimar — para montar a tela de autorização. */
export async function validarToken(token, tipo) {
  const { rows } = await pool.query(
    `SELECT account_id FROM account_tokens
      WHERE token = $1 AND tipo = $2 AND usado_em IS NULL AND expira_em > now()`,
    [token, tipo],
  );
  return rows[0] ? Number(rows[0].account_id) : null;
}

/**
 * Passo 1: valida senha, guarda o e-mail novo e manda link para o e-mail ATUAL.
 * Só quem controla a caixa de hoje autoriza o passo 2.
 */
export async function pedirTrocaEmail({ contaId, novoEmail, senha, senhaNova }) {
  if (!EMAIL_OK.test(novoEmail ?? '')) throw new ErroAuth('login.emailInvalido');
  if (!emailPermitidoCadastro(novoEmail)) throw new ErroAuth('login.emailDominio');
  const conta = await contaCompletaPorId(contaId);
  if (!conta) throw new ErroAuth('login.falhou');
  if (!conta.email) throw new ErroAuth('conta.semEmail');
  if (!resend.ativo()) throw new ErroAuth('conta.emailFalhou');

  const emailNorm = novoEmail.toLowerCase();
  if (emailNorm === String(conta.email ?? '').toLowerCase()) {
    throw new ErroAuth('conta.emailIgual');
  }

  await exigirCaixaLivre(emailNorm, contaId);

  let hashPendente = null;
  if (conta.senha_hash) {
    if (!(await conferirSenha(senha, conta.senha_hash))) throw new ErroAuth('login.credenciaisInvalidas');
  } else {
    if ((senhaNova ?? '').length < 8) throw new ErroAuth('login.senhaCurta');
    hashPendente = await hashSenha(senhaNova);
  }

  await pool.query(
    `UPDATE account_tokens SET usado_em = now()
      WHERE account_id = $1 AND tipo IN ('email_troca_pedido', 'email_troca') AND usado_em IS NULL`,
    [contaId],
  );
  await pool.query(
    `UPDATE accounts SET email_novo_pendente = $2, senha_nova_pendente = $3 WHERE id = $1`,
    [contaId, emailNorm, hashPendente],
  );

  const token = await criarToken(contaId, 'email_troca_pedido', 1);
  const link = `${URL_PUBLICA}/app?autorizarTrocaEmail=${token}`;
  const foi = await enviarEmail({
    para: conta.email,
    assunto: 'Autorizar troca de e-mail — Pokéidle.io',
    html: moldarEmail({
      titulo: 'Pedido de troca de e-mail',
      corpo: `<p style="margin:0 0 12px;line-height:1.7;font-size:14px;">
                Alguém (esperamos que você) pediu para trocar o e-mail da conta
                <b style="color:${CORES.ouro};">${conta.nick}</b>
                de <b style="color:${CORES.ouro};">${conta.email}</b>
                para <b style="color:${CORES.ouro};">${emailNorm}</b>.</p>
              <p style="margin:0;line-height:1.7;font-size:14px;">
                Clique no botão para autorizar. Depois disso, mandamos um segundo link
                para o e-mail <b>novo</b> — a troca só vale quando ele for confirmado.</p>`,
      botao: 'Autorizar troca de e-mail',
      link,
      rodape: `O link vale por <b>1 hora</b> e só funciona uma vez.<br>
               Se não foi você, ignore — <b>seu e-mail continua o mesmo</b>.`,
    }),
  });
  if (!foi) throw new ErroAuth('conta.emailFalhou');
  return { ok: true, email: conta.email };
}

/** Dados para a tela de autorização (link do e-mail atual). */
export async function statusTrocaEmail(token) {
  const contaId = await validarToken(token, 'email_troca_pedido');
  if (!contaId) return null;
  const conta = await contaCompletaPorId(contaId);
  if (!conta?.email_novo_pendente) return null;
  return {
    nick: conta.nick,
    emailAtual: conta.email,
    emailNovo: conta.email_novo_pendente,
  };
}

/**
 * Passo 2: queima o token do e-mail atual e manda confirmação para o e-mail NOVO.
 */
export async function autorizarTrocaEmail(token) {
  const contaId = await usarToken(token, 'email_troca_pedido');
  if (!contaId) return null;
  const conta = await contaCompletaPorId(contaId);
  if (!conta?.email_novo_pendente) return null;

  const emailNorm = conta.email_novo_pendente.toLowerCase();
  await exigirCaixaLivre(emailNorm, contaId);

  const tokenNovo = await criarToken(contaId, 'email_troca', 1);
  const link = `${URL_PUBLICA}/auth/trocar-email/confirmar?token=${tokenNovo}`;
  const foi = await enviarEmail({
    para: emailNorm,
    assunto: 'Confirmar novo e-mail — Pokéidle.io',
    html: moldarEmail({
      titulo: 'Confirmar o seu novo e-mail',
      corpo: `<p style="margin:0 0 12px;line-height:1.7;font-size:14px;">
                A troca de e-mail da conta
                <b style="color:${CORES.ouro};">${conta.nick}</b>
                foi autorizada no endereço antigo.</p>
              <p style="margin:0;line-height:1.7;font-size:14px;">
                Clique no botão para confirmar <b style="color:${CORES.ouro};">${emailNorm}</b>
                como e-mail de login.</p>`,
      botao: 'Confirmar novo e-mail',
      link,
      rodape: `O link vale por <b>1 hora</b> e só funciona uma vez.<br>
               Se não foi você, ignore — <b>o e-mail antigo continua valendo</b>.`,
    }),
  });
  if (!foi) throw new ErroAuth('conta.emailFalhou');
  return { emailNovo: emailNorm };
}

/** Passo 3: aplica a troca depois que a pessoa clica no link do e-mail novo. */
export async function confirmarTrocaEmail(token) {
  const contaId = await usarToken(token, 'email_troca');
  if (!contaId) return null;
  const conta = await contaCompletaPorId(contaId);
  if (!conta?.email_novo_pendente) return null;

  const emailNorm = conta.email_novo_pendente.toLowerCase();
  await exigirCaixaLivre(emailNorm, contaId);

  if (conta.senha_nova_pendente) {
    await pool.query(
      `UPDATE accounts
          SET email = $2, email_canon = $4, email_ok = true,
              email_novo_pendente = NULL, senha_nova_pendente = NULL,
              senha_hash = $3, provedor = 'local', provedor_id = NULL
        WHERE id = $1`,
      [contaId, emailNorm, conta.senha_nova_pendente, emailCanonico(emailNorm)],
    );
  } else {
    await pool.query(
      `UPDATE accounts
          SET email = $2, email_canon = $3, email_ok = true,
              email_novo_pendente = NULL, senha_nova_pendente = NULL
        WHERE id = $1`,
      [contaId, emailNorm, emailCanonico(emailNorm)],
    );
  }
  // Trocar o e-mail é trocar a chave de recuperação da conta: daqui em diante é a caixa NOVA
  // que redefine a senha. Se a troca foi feita por alguém que não devia, as sessões dele caem
  // junto — e o dono legítimo, que ainda tem a senha, entra de novo. Vale para os dois ramos
  // acima: com senha nova (aí é ainda mais óbvio) e sem.
  await revogarSessoes(contaId);
  return contaPorId(contaId);
}

/**
 * A troca feita pelo SUPORTE, sem os dois links — para quem não tem mais como usar a caixa antiga.
 *
 * O caso que a criou: contas cadastradas antes da whitelist de domínios, com endereço que hoje
 * `exigirEmailPermitido` recusa no login. Essa pessoa não entra no jogo, então não chega à tela
 * de troca, e o passo 1 mandaria o link justamente para a caixa que ela não usa mais. Quem
 * autoriza aqui é o admin, que já falou com o jogador pelo suporte.
 *
 * As travas do endereço são as mesmas do cadastro (formato, domínio, caixa livre) — um e-mail
 * fora da whitelist deixaria o jogador trancado do mesmo jeito. `email_ok` vai para true porque
 * o objetivo é ele voltar a entrar com a senha de sempre.
 *
 * O resto segue a troca normal: os links que ainda estavam na caixa ANTIGA (senha, confirmação,
 * troca pendente) morrem, porque ela deixou de ser a chave da conta, e as sessões caem junto.
 *
 * Quem pode pedir, e para qual conta, é decidido em `admin.trocarEmailUsuario`.
 */
const CAIXA_DE_PROVEDOR = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export async function trocarEmailPeloSuporte({ contaId, novoEmail }) {
  const emailNorm = String(novoEmail ?? '').trim().toLowerCase();
  // Mais estreito que o `EMAIL_OK` do cadastro: os provedores da whitelist só aceitam estes
  // caracteres no nome da caixa, e o que o painel grava aqui não tem confirmação por link.
  if (emailNorm.length > 254 || !CAIXA_DE_PROVEDOR.test(emailNorm)) throw new ErroAuth('login.emailInvalido');
  if (!emailPermitidoCadastro(emailNorm)) throw new ErroAuth('login.emailDominio');
  const conta = await contaCompletaPorId(contaId);
  if (!conta) throw new ErroAuth('login.falhou');
  if (emailNorm === String(conta.email ?? '').toLowerCase()) throw new ErroAuth('conta.emailIgual');

  await exigirCaixaLivre(emailNorm, contaId);

  try {
    await pool.query(
      `UPDATE accounts
          SET email = $2, email_canon = $3, email_ok = true,
              email_novo_pendente = NULL, senha_nova_pendente = NULL
        WHERE id = $1`,
      [contaId, emailNorm, emailCanonico(emailNorm)],
    );
  } catch (err) {
    // Alguém cadastrou a mesma caixa entre o `exigirCaixaLivre` e o UPDATE.
    if (err.code === '23505') throw new ErroAuth(chaveDeColisao(err));
    throw err;
  }
  await pool.query(
    `UPDATE account_tokens SET usado_em = now()
      WHERE account_id = $1 AND usado_em IS NULL
        AND tipo IN ('email', 'senha', 'email_troca', 'email_troca_pedido')`,
    [contaId],
  );
  await revogarSessoes(contaId);
  return { nick: conta.nick, anterior: conta.email, email: emailNorm, provedor: conta.provedor };
}

// -------------------------------------------------------- excluir a própria conta

/**
 * LGPD / auto-serviço — exige o nick digitado e, de quem entra por senha, a senha.
 *
 * A senha só é cobrada de conta `local`, e NÃO de "conta que tem `senha_hash`". A diferença
 * aparece em quem criou conta com senha e depois clicou em "Continuar com Google": o
 * `entrarComProvedor` liga as duas e troca o `provedor`, mas o hash antigo continua gravado.
 * Essa pessoa não digita senha há meses — muitas vezes nem sabe qual é — e ficava trancada
 * fora da própria exclusão, num campo que a tela de conta ainda mostrava enquanto o cabeçalho
 * dizia "Entra por: Google".
 *
 * Quem entra pelo provedor prova quem é do mesmo jeito que a conta OAuth sem hash nenhum já
 * provava aqui: a sessão viva (que veio do Google/Discord) mais o nick digitado à mão.
 */
export async function excluirMinhaConta({ contaId, senha, nickConfirmacao }) {
  const conta = await contaCompletaPorId(contaId);
  if (!conta) throw new ErroAuth('login.falhou');
  if (ehAdmin(conta.email)) throw new ErroAuth('conta.excluirAdmin');
  const nick = String(nickConfirmacao ?? '').trim();
  if (!nick || nick.toLowerCase() !== String(conta.nick).toLowerCase()) {
    throw new ErroAuth('conta.excluirNickErrado');
  }
  if (conta.provedor === 'local' && conta.senha_hash) {
    if (!(await conferirSenha(senha, conta.senha_hash))) throw new ErroAuth('login.credenciaisInvalidas');
  }
  return executarExclusaoConta(conta);
}

export { ErroAuth };
