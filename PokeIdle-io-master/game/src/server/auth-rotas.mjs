// As rotas HTTP de conta, penduradas no mesmo servidor que serve o cliente.
//
// São poucas e todas curtas porque a regra mora em `auth.mjs` — aqui só se lê o pedido, chama
// lá e escreve a resposta. O gateway continua sendo I/O puro.
//
// O fluxo OAuth é o "authorization code" clássico, na mesma aba:
//
//   /auth/google            → 302 para o Google, levando `state` assinado
//   /auth/google/retorno    → troca o `code` por um token, lê o perfil, cria/acha a conta,
//                             e volta para `/` com a sessão em `?sessao=<base64>`
//
// O `state` é assinado com o mesmo HMAC da sessão e vale 10 minutos. É a defesa contra CSRF de
// login: sem ele, um atacante consegue fazer a vítima terminar um fluxo iniciado por ele e
// acabar logada na conta do atacante.
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  oauth,
  URL_PUBLICA,
  provedoresAtivos,
  criarConta,
  entrarComSenha,
  entrarComProvedor,
  assinarSessao,
  lerSessao,
  valeRenovar,
  renovarSessao,
  revogarSessoes,
  usarToken,
  mandarConfirmacao,
  mandarRedefinicao,
  mandarAvisoDeProvedor,
  contaPorEmailOuNick,
  contaPorEmail,
  contaPorId,
  trocarSenha,
  escolherNick,
  nickDisponivel,
  esperaParaTrocarSenha,
  esperaParaTrocarEmail,
  pedirTrocaEmail,
  statusTrocaEmail,
  autorizarTrocaEmail,
  confirmarTrocaEmail,
  excluirMinhaConta,
  resend,
  verificarTurnstile,
  ErroAuth,
} from './auth.mjs';
import { pool } from './db.mjs';
import { atribuirNoCadastro } from './afiliados-rotas.mjs';
import { ipCliente, bucketDeIp } from './ip-cliente.mjs';
import { registrarOrigem, dispositivoLimpo, podeCriarNoIp, registrarRecusaDeIp } from './origens-db.mjs';

const json = (res, codigo, corpo) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
};

/**
 * O corpo de erro de uma rota de auth: a chave que a tela traduz, mais o que só o servidor
 * sabe dizer.
 *
 * O `...err.extra` é o que leva o MOTIVO do ban até o login. Está aqui, num lugar só, e não
 * repetido em cada `catch`, porque o `{ erro: err.chave }` já estava copiado em oito rotas —
 * e só uma delas ganhar o campo novo é exatamente como "some no Google mas aparece na senha"
 * acontece.
 */
const corpoDeErro = (err) => ({ erro: err?.chave ?? 'login.falhou', ...(err?.extra ?? {}) });

/** Lê um corpo JSON com teto de tamanho — um POST de 10 MB no login é ataque, não uso. */
function lerCorpo(req, limite = 4096) {
  return new Promise((ok, err) => {
    let dados = '';
    req.on('data', (p) => {
      dados += p;
      if (dados.length > limite) {
        req.destroy();
        err(new Error('corpo grande demais'));
      }
    });
    req.on('end', () => {
      try {
        ok(JSON.parse(dados || '{}'));
      } catch {
        err(new Error('json inválido'));
      }
    });
    req.on('error', err);
  });
}

// ----------------------------------------------------------------- rate limit
//
// Balde por IP, em memória. Não substitui um WAF na frente — é o que impede um script de
// varrer senhas a mil por segundo enquanto o WAF não existe. Em memória e por processo basta:
// o atacante teria de distribuir o ataque por N gateways para ganhar N vezes o limite, o que
// já é outro patamar de esforço.

const baldes = new Map();
const LIMITE = { tentativas: 12, janelaMs: 60_000 };

function passouDoLimite(ip) {
  const agora = Date.now();
  const b = baldes.get(ip);
  if (!b || agora > b.zeraEm) {
    baldes.set(ip, { n: 1, zeraEm: agora + LIMITE.janelaMs });
    return false;
  }
  b.n++;
  return b.n > LIMITE.tentativas;
}
// O mapa é limpo de tempos em tempos para não virar um vazamento com IP rotativo.
setInterval(() => {
  const agora = Date.now();
  for (const [ip, b] of baldes) if (agora > b.zeraEm) baldes.delete(ip);
}, 60_000).unref();

// Cooldown CRESCENTE por IP entre e-mails que NÓS disparamos a pedido de quem nem está logado.
//
// Conta quantos já saíram daquele IP; o próximo só depois do intervalo do degrau atual. É o que
// impede que a nossa caixa de saída vire canal de spam de graça: sem isto, um script enche a
// caixa de qualquer jogador assinado por nós, e o nosso domínio é que paga a reputação.
//
// Cada fluxo tem o seu balde, com a sua escada — confirmar cadastro e recuperar senha não têm
// o mesmo perfil de uso honesto — mas a mecânica é uma só, aqui.
function baldeDeEmails(passos, chaveErro) {
  const porIp = new Map();
  const degrau = (s) => passos[Math.min(s.count - 1, passos.length - 1)];

  setInterval(() => {
    const agora = Date.now();
    for (const [ip, s] of porIp) if (agora - s.lastSend > passos.at(-1)) porIp.delete(ip);
  }, 300_000).unref();

  return {
    /** Quanto falta até este IP poder disparar de novo — 0 se já pode. */
    espera(ip) {
      const s = porIp.get(ip);
      if (!s?.count) return 0;
      return Math.max(0, s.lastSend + degrau(s) - Date.now());
    },
    registrar(ip) {
      const s = porIp.get(ip) ?? { count: 0, lastSend: 0 };
      s.count++;
      s.lastSend = Date.now();
      porIp.set(ip, s);
    },
    /** Quanto o PRÓXIMO e-mail deste IP vai custar de espera (degrau atual). */
    proxima(ip) {
      const s = porIp.get(ip);
      return s?.count ? degrau(s) : passos[0];
    },
    /** Responde 429 e devolve `true` quando o IP ainda está no cooldown. */
    recusar(res, ip) {
      const esperaMs = this.espera(ip);
      if (esperaMs <= 0) return false;
      json(res, 429, { erro: chaveErro, esperaMs });
      return true;
    },
  };
}

// Confirmação de cadastro: 1 min → 1 h → 1 dia. Quem cria conta de verdade manda um e-mail,
// no máximo dois; a partir daí é script.
const emailsConfirmacao = baldeDeEmails([60_000, 3_600_000, 86_400_000], 'conta.confirmacaoEspere');

// "Esqueci minha senha": a escada é mais macia porque errar o endereço na primeira tentativa é
// comum (a pessoa não lembra COM QUAL e-mail se cadastrou), e a trava que realmente importa
// contra encher a caixa de alguém é a de 1 h POR CONTA, que vive no banco.
const emailsEsqueci = baldeDeEmails([60_000, 120_000, 600_000, 3_600_000], 'conta.esqueciEspere');

/** O IP do jogador. A regra de confianca mora em `ip-cliente.mjs` - leia la antes de mexer. */
const ipDe = (req) => ipCliente(req);

/**
 * Carimba de onde esta conta entrou. Dispara e esquece — ver `origens-db.mjs` para o porquê de
 * isto ser só um registro, sem nenhuma recusa pendurada.
 *
 * `.catch` explícito mesmo com a gravação já sendo à prova de erro: um dia alguém mexe lá
 * dentro, e uma promessa rejeitada sem dono derruba o processo do gateway inteiro.
 */
const carimbar = (req, conta, evento, dispositivo = null) => {
  const ip = ipDe(req);
  registrarOrigem({
    contaId: conta?.id,
    nick: conta?.nick ?? null,
    evento,
    ip,
    ipBucket: bucketDeIp(ip),
    dispositivo,
  }).catch(() => {});
};

/**
 * O teto de contas por IP, do lado da rota. Lança quando a rede já abriu o que podia.
 *
 * Vale para os DOIS caminhos de cadastro — o formulário e o botão do Google/Discord —, e por
 * baixo é sempre a mesma pergunta, em `origens-db.mjs`, que também explica por que ela conta
 * quem NASCEU na rede e por que ela falha aberta.
 *
 * Chamado depois do Turnstile, e não antes: a resposta diz quantas contas existem naquela
 * saída de rede, e isso é informação sobre terceiros. Atrás do Turnstile, quem pergunta é
 * gente; na frente dele, um script varreria faixas de IP para mapear onde estão os
 * aglomerados.
 *
 * A recusa é CONTADA (`registrarRecusaDeIp`). Sem esse número, o dia em que o teto começar a
 * atropelar um CGNAT de operadora passa em silêncio: o jogador legítimo desiste, não escreve
 * para o suporte, e o painel continua verde.
 */
const exigirVagaNoIp = async (req) => {
  const bucket = bucketDeIp(ipDe(req));
  const veredito = await podeCriarNoIp(bucket);
  if (veredito.pode) return;
  await registrarRecusaDeIp(bucket);
  console.log(`[origens] cadastro recusado: ${bucket} já tem ${veredito.contas}/${veredito.limite} contas`);
  throw new ErroAuth('login.limiteContasIp');
};

/** Conta que nasceu agora? Usado no retorno do OAuth, onde não há outro jeito de saber. */
const contaRecemCriada = (conta) => {
  const em = conta?.criado_em ? new Date(conta.criado_em).getTime() : 0;
  return em > 0 && Date.now() - em < 15_000;
};

// --------------------------------------------------------------- state OAuth

// O `dispositivo` viaja DENTRO do state assinado, e não como parâmetro solto na volta: o
// state já é o único campo que a gente controla e que o provedor devolve intacto, já é
// assinado com o mesmo HMAC da sessão e já tem prazo. Mandar o id por fora abriria um campo
// que qualquer um escreve na URL de retorno — e um carimbo de origem que o visitante escolhe
// não carimba nada.
const assinarState = (provedor, dispositivo = null) => {
  const corpo = Buffer.from(JSON.stringify({ provedor, dispositivo, exp: Date.now() + 600_000 })).toString('base64url');
  const mac = createHmac('sha256', process.env.AUTH_SEGREDO ?? 'dev').update(corpo).digest('base64url');
  return `${corpo}.${mac}`;
};

const lerState = (state) => {
  const [corpo, mac] = String(state ?? '').split('.');
  if (!corpo || !mac) return null;
  const certo = createHmac('sha256', process.env.AUTH_SEGREDO ?? 'dev').update(corpo).digest('base64url');
  if (mac.length !== certo.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(certo))) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return d.exp > Date.now() ? d : null;
  } catch {
    return null;
  }
};

const redirectUri = (provedor) => `${URL_PUBLICA}/auth/${provedor}/retorno`;

/**
 * `pedro@gmail.com` → `pe•••@gmail.com`.
 *
 * A tela precisa dizer PARA ONDE o link vai, e o endereço inteiro numa tela que alguém pode
 * estar transmitindo (ou com gente olhando por cima) é mais do que ela precisa mostrar. As
 * duas primeiras letras e o domínio bastam para a pessoa reconhecer a própria caixa.
 */
const mascararEmail = (email) => {
  if (!email) return null;
  const [nome, dominio] = String(email).split('@');
  if (!dominio) return null;
  return `${nome.slice(0, 2)}${'•'.repeat(Math.max(3, nome.length - 2))}@${dominio}`;
};

// `async` porque `assinarSessao` foi buscar a época de revogação da conta (ver auth.mjs).
const respostaDeSessao = async (conta, extra = {}) => ({
  nick: conta.nick,
  token: await assinarSessao({ nick: conta.nick, contaId: Number(conta.id), provedor: conta.provedor ?? 'local' }),
  provedor: conta.provedor ?? 'local',
  // O onboarding pergunta o nick antes de tudo para quem ainda não escolheu o próprio nome
  // (provedor externo ou cadastro local com confirmação de e-mail). Vai na SESSÃO (e não só
  // em `/auth/conta`) porque o cliente precisa saber disso antes de abrir o socket: o nick É
  // a chave da conexão.
  precisaNick: conta.nick_ok === false,
  ...extra,
});

/** A sessão volta ao cliente pela barra de endereço; o JS de lá guarda e limpa a URL. */
const voltarComSessao = async (res, conta) => {
  // Monta a sessão pelo MESMO caminho do login com senha.
  //
  // Antes este bloco montava o objeto à mão, com três campos escolhidos aqui — e foi assim que
  // o `precisaNick` se perdeu justamente no fluxo que mais precisa dele: quem entra por Google
  // ou Discord é exatamente quem NÃO escolheu o próprio nick (o `nickLivre` inventou um a
  // partir do nome do provedor). O jogador caía direto no jogo chamado "Pedro" sem nunca ter
  // sido perguntado.
  //
  // Duas montagens do mesmo objeto divergem no primeiro campo novo. Agora só existe uma.
  const sessao = Buffer.from(JSON.stringify(await respostaDeSessao(conta))).toString('base64');
  res.writeHead(302, { location: `/app?sessao=${encodeURIComponent(sessao)}` }).end();
};


// ---------------------------------------------------------------- o roteador

/**
 * Trata `/auth/*`. Devolve `true` quando respondeu — o servidor estático só continua se
 * a rota não for daqui.
 */
export async function rotasDeAuth(req, res, url) {
  const rota = url.pathname;
  if (!rota.startsWith('/auth/')) return false;

  // ---- quais provedores existem, para a tela de login saber o que desenhar
  if (rota === '/auth/provedores') {
    json(res, 200, provedoresAtivos());
    return true;
  }

  // ---- criar conta
  //
  // Com e-mail configurado, criar conta NÃO entra no jogo: devolve só "confirme sua caixa" e a
  // pessoa volta pelo login depois de clicar no link. É uma fricção real, e é intencional —
  // sem ela o e-mail de uma conta é um palpite, e é nele que se apoiam a recuperação de senha
  // e a titularidade antes de um saque de ORB.
  //
  // Sem Resend configurado, o comportamento antigo continua: entra na hora, porque não haveria
  // como confirmar nada e a alternativa seria uma conta impossível de usar.
  if (rota === '/auth/criar' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req))) return json(res, 429, { erro: 'login.muitasTentativas' }), true;
    try {
      const { nick, email, senha, ref, turnstileToken, dispositivo } = await lerCorpo(req);
      if (!(await verificarTurnstile(turnstileToken, ipDe(req)))) {
        return json(res, 400, { erro: 'login.turnstileFalhou' }), true;
      }
      await exigirVagaNoIp(req);
      const conta = await criarConta({ nick, email, senha });
      carimbar(req, conta, 'criar', dispositivoLimpo(dispositivo));
      await atribuirNoCadastro(conta.id, ref);
      if (!resend.ativo()) {
        json(res, 200, await respostaDeSessao(conta, { precisaConfirmar: false }));
        return true;
      }
      const ip = ipDe(req);
      if (emailsConfirmacao.recusar(res, ip)) return true;
      // O e-mail sai em segundo plano: a resposta não espera o Resend. Segurar a tela num SMTP
      // de terceiro é o tipo de espera que o jogador lê como "travou".
      mandarConfirmacao(conta).catch(() => {});
      emailsConfirmacao.registrar(ip);
      json(res, 200, {
        precisaConfirmar: true,
        email: mascararEmail(conta.email),
        confirmacaoEsperaMs: emailsConfirmacao.proxima(ip),
      });
    } catch (err) {
      json(res, err instanceof ErroAuth ? 400 : 500, corpoDeErro(err));
    }
    return true;
  }

  // ---- reenviar a confirmação
  //
  // Pede a SENHA de novo, e não só o nick: sem isso, qualquer um dispara e-mail para a caixa de
  // qualquer jogador só sabendo o nome dele — um canal de spam de graça, assinado por nós.
  if (rota === '/auth/reenviar' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req))) return json(res, 429, { erro: 'login.muitasTentativas' }), true;
    try {
      const { id, senha } = await lerCorpo(req);
      let conta = null;
      try {
        conta = await entrarComSenha({ id, senha });
      } catch (err) {
        // `login.confirmeEmail` é exatamente o caso que esta rota existe para resolver: a senha
        // bateu e falta confirmar. Qualquer outro erro é credencial errada mesmo.
        if (err.chave !== 'login.confirmeEmail') throw err;
        conta = await contaPorEmailOuNick(id);
      }
      if (!conta?.email) return json(res, 400, { erro: 'conta.semEmail' }), true;
      if (conta.email_ok) return json(res, 200, { jaConfirmado: true }), true;
      const ip = ipDe(req);
      if (emailsConfirmacao.recusar(res, ip)) return true;
      const foi = await mandarConfirmacao(conta);
      if (foi) emailsConfirmacao.registrar(ip);
      json(res, foi ? 200 : 500, foi ? {
        ok: true,
        email: mascararEmail(conta.email),
        confirmacaoEsperaMs: emailsConfirmacao.proxima(ip),
      } : { erro: 'conta.emailFalhou' });
    } catch (err) {
      json(res, err instanceof ErroAuth ? 401 : 500, corpoDeErro(err));
    }
    return true;
  }

  // ---- escolher o nick (onboarding de quem entrou por Google/Discord ou criou conta local)
  //
  // Devolve uma SESSÃO NOVA, e não só `ok`: o nick vai dentro do token assinado, e continuar
  // com o token velho faria o socket abrir com o nome inventado pelo provedor.
  if (rota === '/auth/nick' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req))) return json(res, 429, { erro: 'login.muitasTentativas' }), true;
    try {
      const { token, nick, ref, dispositivo } = await lerCorpo(req);
      const sessao = await lerSessao(token);
      if (!sessao?.contaId) return json(res, 401, { erro: 'login.falhou' }), true;
      const conta = await escolherNick(sessao.contaId, String(nick ?? '').trim());
      carimbar(req, conta, 'entrar', dispositivoLimpo(dispositivo));
      await atribuirNoCadastro(conta.id, ref);
      json(res, 200, await respostaDeSessao(conta));
    } catch (err) {
      json(res, err instanceof ErroAuth ? 400 : 500, corpoDeErro(err));
    }
    return true;
  }

  // ---- o nick está livre? (o "disponível ✓" que aparece enquanto se digita)
  //
  // É só cortesia de tela: quem decide é o `/auth/nick`, que revalida tudo. Sem token de
  // propósito — a pergunta não revela nada que o próprio cadastro não revele ao tentar.
  if (rota === '/auth/nick-livre' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req))) return json(res, 429, { erro: 'login.muitasTentativas' }), true;
    try {
      const { nick } = await lerCorpo(req);
      json(res, 200, { livre: await nickDisponivel(String(nick ?? '').trim()) });
    } catch {
      json(res, 400, { erro: 'login.falhou' });
    }
    return true;
  }

  // ---- entrar com senha
  if (rota === '/auth/entrar' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req))) return json(res, 429, { erro: 'login.muitasTentativas' }), true;
    try {
      const { id, senha, turnstileToken, dispositivo } = await lerCorpo(req);
      if (!(await verificarTurnstile(turnstileToken, ipDe(req)))) {
        return json(res, 400, { erro: 'login.turnstileFalhou' }), true;
      }
      const conta = await entrarComSenha({ id, senha });
      carimbar(req, conta, 'entrar', dispositivoLimpo(dispositivo));
      json(res, 200, await respostaDeSessao(conta));
    } catch (err) {
      json(res, err instanceof ErroAuth ? 401 : 500, corpoDeErro(err));
    }
    return true;
  }

  // ---- a ficha da conta de quem está logado
  //
  // Autentica pelo TOKEN de sessão, não pelo nick: pedir a ficha de qualquer um só passando o
  // nome entregaria o e-mail de todo mundo. O e-mail volta mascarado — a tela só precisa
  // mostrar "para onde vai o link", não o endereço inteiro.
  if (rota === '/auth/conta' && req.method === 'POST') {
    try {
      const { token } = await lerCorpo(req);
      const sessao = await lerSessao(token);
      if (!sessao?.contaId) return json(res, 401, { erro: 'login.falhou' }), true;
      const conta = await contaPorId(sessao.contaId);
      if (!conta) return json(res, 404, { erro: 'login.falhou' }), true;
      json(res, 200, {
        nick: conta.nick,
        precisaNick: conta.nick_ok === false,
        // RENOVAÇÃO DESLIZANTE. O cliente chama esta rota a cada carga de página; passada a
        // metade dos 30 dias, ele leva um token novo e volta a ter 30 dias pela frente.
        //
        // É o que faz "sessão com prazo" e "jogo idle que não desloga" conviverem: quem entra
        // ao menos uma vez a cada 15 dias nunca mais vê a tela de login, e quem sumiu continua
        // expirando no prazo — a janela de um token roubado não muda.
        //
        // `null` quando ainda não vale a pena; o cliente só grava quando vem string.
        tokenNovo: valeRenovar(sessao) ? await renovarSessao(sessao) : null,
        email: mascararEmail(conta.email),
        temEmail: !!conta.email,
        provedor: conta.provedor,
        emailOk: conta.email_ok,
        temSenha: conta.tem_senha,
        // Sem Resend configurado o botão de trocar senha não teria como funcionar; a tela
        // precisa saber disso para explicar em vez de falhar no clique.
        emailLigado: resend.ativo(),
        // Quanto falta do limite de 1 pedido por hora. Vai junto da ficha para o botão já
        // ABRIR com a contagem, em vez de parecer disponível e recusar no clique.
        senhaEsperaMs: conta.tem_senha ? await esperaParaTrocarSenha(conta.id) : 0,
        emailEsperaMs: await esperaParaTrocarEmail(conta.id),
        oauth: conta.provedor !== 'local',
      });
    } catch {
      json(res, 400, { erro: 'login.falhou' });
    }
    return true;
  }

  // ---- sair de TODOS os aparelhos
  //
  // O "Sair" comum é local: apaga o `localStorage` daquele navegador e pronto. Ele resolve o
  // caso de sempre (o computador do trabalho) e não resolve o único que importa de verdade —
  // "acho que alguém entrou na minha conta". Para esse, apagar o próprio token é justamente o
  // que NÃO adianta: quem tem a cópia continua com ela.
  //
  // Esta rota queima a geração inteira: todo token daquela conta para de valer, no aparelho de
  // quem pediu inclusive. É de propósito — quem clica aqui está dizendo "não confio em nenhuma
  // sessão aberta", e abrir uma exceção para a atual é confiar numa delas.
  //
  // Exige o token válido: sem ele, seria um botão para deslogar os outros de graça.
  if (rota === '/auth/sair-de-tudo' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req))) return json(res, 429, { erro: 'login.muitasTentativas' }), true;
    try {
      const { token } = await lerCorpo(req);
      const sessao = await lerSessao(token);
      if (!sessao?.contaId) return json(res, 401, { erro: 'login.falhou' }), true;
      await revogarSessoes(sessao.contaId);
      json(res, 200, { ok: true });
    } catch {
      json(res, 400, { erro: 'login.falhou' });
    }
    return true;
  }

  // ---- pedir o link de troca de senha
  if (rota === '/auth/recuperar' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req))) return json(res, 429, { erro: 'login.muitasTentativas' }), true;
    try {
      const { token } = await lerCorpo(req);
      const sessao = await lerSessao(token);
      if (!sessao?.contaId) return json(res, 401, { erro: 'login.falhou' }), true;
      const conta = await contaPorId(sessao.contaId);
      if (!conta?.email) return json(res, 400, { erro: 'conta.semEmail' }), true;
      const espera = await esperaParaTrocarSenha(conta.id);
      if (espera > 0) return json(res, 429, { erro: 'conta.senhaEspere', esperaMs: espera }), true;
      const foi = await mandarRedefinicao(conta);
      json(res, foi ? 200 : 500, foi ? { ok: true } : { erro: 'conta.emailFalhou' });
    } catch {
      json(res, 500, { erro: 'login.falhou' });
    }
    return true;
  }

  // ---- "esqueci minha senha": o mesmo link, para quem NÃO consegue entrar
  //
  // É a versão sem sessão do `/auth/recuperar` acima. Como não há token para autenticar, a
  // única coisa que identifica o pedido é o que a pessoa digitou — e é isso que torna a rota
  // delicada. Quatro regras a seguram:
  //
  // 1. **Só e-mail, nunca nick.** O nick é público — está no ranking, no chat, na guild — e
  //    aceitá-lo aqui deixaria qualquer um encher a caixa de quem ele vê no ranking sem nunca
  //    ter sabido o endereço, com o nosso domínio assinando o spam. Exigir o e-mail obriga
  //    quem pede a já ter aquilo que ele queria alcançar. Ver `contaPorEmail`.
  // 2. **A resposta é sempre a mesma.** Conta que não existe, conta sem e-mail, conta em
  //    cooldown, conta de Google — tudo devolve o mesmo `{ ok: true }`. Responder diferente
  //    transformaria esta rota num verificador de "esse e-mail joga aqui?", e a lista de
  //    quem tem conta é justamente o que não pode sair de graça. Pelo mesmo motivo o trabalho
  //    não é interrompido cedo: quem não tem conta e quem tem passam pelo mesmo caminho.
  // 3. **Turnstile**, como no entrar e no criar — sem ele um script varre uma lista de e-mails.
  // 4. **Dois cooldowns**: o do IP (aqui, crescente) e o de 1 h POR CONTA, que já existe no
  //    banco e é o que impede encher a caixa de um jogador específico a partir de mil IPs.
  //
  // O e-mail sai em segundo plano de propósito: esperar o Resend faria a resposta demorar
  // conforme a conta exista ou não — o mesmo vazamento, agora pelo relógio.
  if (rota === '/auth/esqueci' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req))) return json(res, 429, { erro: 'login.muitasTentativas' }), true;
    const ip = ipDe(req);
    try {
      const { email, turnstileToken } = await lerCorpo(req);
      if (!(await verificarTurnstile(turnstileToken, ip))) {
        return json(res, 400, { erro: 'login.turnstileFalhou' }), true;
      }
      if (emailsEsqueci.recusar(res, ip)) return true;
      // O balde do IP anda ANTES de saber se a conta existe: se só andasse quando um e-mail
      // sai, o próprio cooldown viraria a resposta que o item 1 acima esconde.
      emailsEsqueci.registrar(ip);

      const conta = await contaPorEmail(email);
      if (conta?.email) {
        if (!conta.senha_hash) {
          // Conta de provedor: não há senha nossa para trocar, e quem explica é o e-mail.
          mandarAvisoDeProvedor(conta).catch(() => {});
        } else if ((await esperaParaTrocarSenha(conta.id)) <= 0) {
          mandarRedefinicao(conta).catch(() => {});
        }
      }
      json(res, 200, { ok: true, esperaMs: emailsEsqueci.proxima(ip) });
    } catch {
      // Até o erro é genérico: um 500 em "e-mail não existe" e um 200 em "existe" contam a
      // mesma história que a resposta uniforme acabou de esconder.
      json(res, 200, { ok: true, esperaMs: emailsEsqueci.proxima(ip) });
    }
    return true;
  }

  // ---- pedir troca de e-mail (passo 1: link vai para o e-mail ATUAL)
  if (rota === '/auth/trocar-email/pedir' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req))) return json(res, 429, { erro: 'login.muitasTentativas' }), true;
    try {
      const { token, novoEmail, senha, senhaNova } = await lerCorpo(req);
      const sessao = await lerSessao(token);
      if (!sessao?.contaId) return json(res, 401, { erro: 'login.falhou' }), true;
      const espera = await esperaParaTrocarEmail(sessao.contaId);
      if (espera > 0) return json(res, 429, { erro: 'conta.trocarEmailEspere', esperaMs: espera }), true;
      const r = await pedirTrocaEmail({
        contaId: sessao.contaId,
        novoEmail: String(novoEmail ?? '').trim(),
        senha,
        senhaNova,
      });
      json(res, 200, { ok: true, email: mascararEmail(r.email) });
    } catch (err) {
      if (err instanceof ErroAuth) console.warn('[auth] trocar-email/pedir:', err.chave);
      json(res, err instanceof ErroAuth ? 400 : 500, corpoDeErro(err));
    }
    return true;
  }

  // ---- status da troca (tela do link do e-mail atual)
  if (rota === '/auth/trocar-email/status' && req.method === 'GET') {
    try {
      const st = await statusTrocaEmail(url.searchParams.get('token'));
      if (!st) return json(res, 400, { erro: 'conta.linkVencido' }), true;
      json(res, 200, {
        nick: st.nick,
        emailAtual: mascararEmail(st.emailAtual),
        emailNovo: mascararEmail(st.emailNovo),
      });
    } catch {
      json(res, 400, { erro: 'conta.linkVencido' });
    }
    return true;
  }

  // ---- autorizar troca (passo 2: manda link para o e-mail NOVO)
  if (rota === '/auth/trocar-email/autorizar' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req))) return json(res, 429, { erro: 'login.muitasTentativas' }), true;
    try {
      const { token } = await lerCorpo(req);
      const r = await autorizarTrocaEmail(token);
      if (!r) return json(res, 400, { erro: 'conta.linkVencido' }), true;
      json(res, 200, { ok: true, email: mascararEmail(r.emailNovo) });
    } catch (err) {
      json(res, err instanceof ErroAuth ? 400 : 500, corpoDeErro(err));
    }
    return true;
  }

  // ---- confirmar troca de e-mail (passo 3: link do e-mail novo)
  if (rota === '/auth/trocar-email/confirmar') {
    try {
      const conta = await confirmarTrocaEmail(url.searchParams.get('token'));
      res.writeHead(302, { location: conta ? '/app?emailTrocado=1' : '/app?erroAuth=token' }).end();
    } catch (err) {
      const chave = err instanceof ErroAuth ? err.chave : 'token';
      res.writeHead(302, { location: `/app?erroAuth=${encodeURIComponent(chave)}` }).end();
    }
    return true;
  }

  // ---- excluir a própria conta (LGPD)
  if (rota === '/auth/excluir' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req))) return json(res, 429, { erro: 'login.muitasTentativas' }), true;
    try {
      const { token, senha, nickConfirmacao } = await lerCorpo(req);
      const sessao = await lerSessao(token);
      if (!sessao?.contaId) return json(res, 401, { erro: 'login.falhou' }), true;
      await excluirMinhaConta({
        contaId: sessao.contaId,
        senha,
        nickConfirmacao: String(nickConfirmacao ?? '').trim(),
      });
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, err instanceof ErroAuth ? 400 : 500, corpoDeErro(err));
    }
    return true;
  }

  // ---- gravar a senha nova
  if (rota === '/auth/redefinir' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req))) return json(res, 429, { erro: 'login.muitasTentativas' }), true;
    try {
      const { token, senha } = await lerCorpo(req);
      // A senha é conferida ANTES de o token ser tocado, e a repetição da regra que mora em
      // `trocarSenha` é de propósito: `usarToken` QUEIMA o link na mesma query em que o lê,
      // então uma senha curta consumia a única chance da pessoa — e, vindo do "esqueci minha
      // senha", ela ainda cairia no cooldown de 1 h sem conseguir pedir outro link. Um erro
      // de digitação não pode custar isso. Quem decide continua sendo `trocarSenha`.
      if (String(senha ?? '').length < 8) return json(res, 400, { erro: 'login.senhaCurta' }), true;
      // `usarToken` já é a autenticação: ele só devolve conta para um token que existe, é do
      // tipo certo, não venceu e nunca foi usado — e o marca como usado na mesma query.
      const contaId = await usarToken(token, 'senha');
      if (!contaId) return json(res, 400, { erro: 'conta.linkVencido' }), true;
      await trocarSenha(contaId, senha);
      // Chegar aqui É a prova de que a caixa é da pessoa — o token veio de dentro dela. Sem
      // esta linha, quem recuperou a senha de uma conta que nunca confirmou o e-mail entrava
      // agora (a resposta traz sessão) e levava `login.confirmeEmail` no login seguinte.
      await pool.query(`UPDATE accounts SET email_ok = true WHERE id = $1`, [contaId]);
      const conta = await contaPorId(contaId);
      json(res, 200, await respostaDeSessao(conta));
    } catch (err) {
      json(res, err instanceof ErroAuth ? 400 : 500, corpoDeErro(err));
    }
    return true;
  }

  // ---- confirmar e-mail
  if (rota === '/auth/confirmar') {
    const contaId = await usarToken(url.searchParams.get('token'), 'email');
    if (contaId) await pool.query(`UPDATE accounts SET email_ok = true WHERE id = $1`, [contaId]);
    res.writeHead(302, { location: contaId ? '/app?emailOk=1' : '/app?erroAuth=token' }).end();
    return true;
  }

  // ---- OAuth: ida
  for (const provedor of ['google', 'discord']) {
    if (rota !== `/auth/${provedor}`) continue;
    const cfg = oauth[provedor];
    if (!cfg.clientId) return res.writeHead(302, { location: '/app?erroAuth=off' }).end(), true;
    const q = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUri(provedor),
      response_type: 'code',
      scope: cfg.escopo,
      state: assinarState(provedor, dispositivoLimpo(url.searchParams.get('d'))),
    });
    res.writeHead(302, { location: `${cfg.autorizar}?${q}` }).end();
    return true;
  }

  // ---- OAuth: volta
  for (const provedor of ['google', 'discord']) {
    if (rota !== `/auth/${provedor}/retorno`) continue;
    const cfg = oauth[provedor];
    const code = url.searchParams.get('code');
    const state = lerState(url.searchParams.get('state'));
    if (!code || !state || state.provedor !== provedor) {
      res.writeHead(302, { location: '/app?erroAuth=state' }).end();
      return true;
    }
    try {
      const tk = await fetch(cfg.token, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri(provedor),
        }),
      }).then((r) => r.json());
      if (!tk.access_token) throw new Error(tk.error_description ?? 'sem access_token');

      const perfil = await fetch(cfg.perfil, {
        headers: { authorization: `Bearer ${tk.access_token}` },
      }).then((r) => r.json());

      // Os dois provedores nomeiam os campos de jeitos diferentes; normaliza-se aqui, que é o
      // único lugar do sistema que precisa saber disso.
      //
      // ### O e-mail só vale se o PROVEDOR disser que o confirmou
      //
      // `entrarComProvedor` usa este e-mail para ENTRAR numa conta que já existe — é assim que
      // quem criou conta com senha e depois clica em "Continuar com Google" mantém o
      // personagem. Isso transforma o campo `email` do perfil em credencial: quem conseguir
      // fazer o provedor devolver o endereço de outra pessoa recebe uma sessão assinada da
      // conta dela. E era isso que estava aberto — nada aqui lia a confirmação.
      //
      // Os dois provedores publicam o campo justamente porque ele pode ser `false`: no Discord
      // dá para trocar o e-mail da conta e usá-la antes de confirmar o novo endereço, e o
      // Google devolve `email_verified: false` em contas Workspace de domínio que ele não
      // validou. Apontar o e-mail para o de um admin e clicar em "Continuar com Discord" era o
      // caminho mais curto para o painel — mais curto que qualquer trava do `/admin`.
      //
      // `=== true` de propósito: `undefined` (provedor que parou de mandar o campo, resposta
      // truncada) tem de cair no NÃO. Este é um lugar onde a ausência de informação não pode
      // valer como permissão.
      const emailConfirmadoLaFora = provedor === 'google'
        ? perfil.email_verified === true
        : perfil.verified === true;
      if (perfil.email && !emailConfirmadoLaFora) {
        throw new ErroAuth('login.emailProvedorNaoConfirmado');
      }

      const conta = await entrarComProvedor({
        provedor,
        provedorId: perfil.sub ?? perfil.id,
        email: perfil.email ?? null,
        // Vai junto, e não fica só no `if` acima, porque quem USA o e-mail como credencial é
        // `entrarComProvedor` — a trava tem de viajar com o dado até lá.
        emailConfirmado: emailConfirmadoLaFora,
        nomeSugerido: perfil.given_name ?? perfil.username ?? perfil.name ?? '',
        // Só dispara quando a conta vai NASCER — quem já tem conta entra por aqui todo dia e
        // não pode esbarrar num teto de cadastro. Ver o gancho em `entrarComProvedor`.
        antesDeCriar: () => exigirVagaNoIp(req),
      });
      // `criado_em` é o único jeito de saber, aqui, se o botão do Google acabou de ABRIR uma
      // conta ou só entrou numa que já existia — `entrarComProvedor` devolve a linha dos dois
      // jeitos. Carimbar isso importa: cadastro por provedor é o caminho mais curto para
      // criar contas em série (não passa nem por Turnstile nem por confirmação de e-mail), e
      // é justamente o que o painel precisa enxergar.
      // `dispositivoLimpo` de novo, embora o `state` seja assinado por nós e o valor já tenha
      // passado por ele na ida: é a mesma função nas duas pontas, e o dia em que alguém mexer
      // na assinatura não pode ser o dia em que um campo livre chega ao banco.
      carimbar(req, conta, contaRecemCriada(conta) ? 'criar' : 'entrar', dispositivoLimpo(state.dispositivo));
      await voltarComSessao(res, conta);
    } catch (err) {
      console.error(`[auth] ${provedor} falhou:`, err.message);
      const chave = err instanceof ErroAuth ? err.chave : 'provedor';
      // O OAuth não responde JSON: ele REDIRECIONA, e a única bagagem que sobrevive ao
      // redirecionamento é a query. Então o motivo do ban viaja por ela — era por isso que
      // entrar por Google/Discord mostrava a frase genérica enquanto a senha (que responde
      // JSON) tinha como mostrar o motivo. `/app` limpa a barra assim que lê.
      const motivo = err?.extra?.motivoBan;
      const destino = `/app?erroAuth=${encodeURIComponent(chave)}`
        + (motivo ? `&motivoBan=${encodeURIComponent(motivo)}` : '');
      res.writeHead(302, { location: destino }).end();
    }
    return true;
  }

  json(res, 404, { erro: 'rota desconhecida' });
  return true;
}
