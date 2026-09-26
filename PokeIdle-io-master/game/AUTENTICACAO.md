# Contas — senha, Google e Discord

O jogo só aceita **usuários registrados e logados**. Não existe entrada anônima nem token de convidado.

| Caminho | Como identifica | Para quem |
|---|---|---|
| **Conta local** | nick ou e-mail + senha | quem quer uma senha própria |
| **Provedor** | Google ou Discord | quem não quer inventar mais uma senha |

O WebSocket exige um **token de sessão assinado** no `hello`. Sem conta válida, o cliente fica na tela de login.

O jogo inteiro roteia por **nick** (`players.nick` é UNIQUE e é a chave do socket, do shard e da
presença). A conta não substitui isso — ela **aponta** para o nick. É o que permitiu ligar contas
sem reescrever o roteamento.

Arquivos: [src/server/auth.mjs](src/server/auth.mjs) (regra) e
[src/server/auth-rotas.mjs](src/server/auth-rotas.mjs) (HTTP). A tela é a `#login` do
[index.html](src/client/index.html).

Ferramentas de teste (`tools/smoke.mjs`, `tools/loadtest.mjs`, etc.) usam
[tools/auth-teste.mjs](tools/auth-teste.mjs) para criar conta ou entrar com senha — o mesmo
caminho de um jogador real.

---

## O que já funciona sem configurar nada

Contas com senha. `AUTH_SEGREDO` vazio faz o servidor gerar um segredo efêmero no boot (as
sessões caem a cada restart) e avisar no log. Os botões de Google e Discord **não aparecem**
enquanto não houver chave — um "Login com Google" que devolve erro é pior que não existir.

Para conferir se estão ligados, sem abrir o navegador:

```bash
curl -s localhost:8080/auth/provedores   # {"google":false,"discord":false}
```

## O que falta você configurar

Tudo em `.env` (veja [.env.example](.env.example), seção "contas").

### 1. Segredo da sessão — obrigatório em produção

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```
AUTH_SEGREDO=<o hex de 64 caracteres>
URL_PUBLICA=https://pokeidle.io
```

`URL_PUBLICA` é o endereço público do jogo. É com ele que se monta o `redirect_uri` do OAuth, e
ele precisa bater **caractere a caractere** com o que estiver cadastrado no Google e no Discord —
divergir aqui é o erro nº 1 de OAuth (`redirect_uri_mismatch`).

### 2. Google

1. [console.cloud.google.com](https://console.cloud.google.com) → **APIs e Serviços** →
   **Credenciais** → *Criar credenciais* → **ID do cliente OAuth** → tipo **Aplicativo da Web**.
2. Em **URIs de redirecionamento autorizados**, exatamente:
   `https://pokeidle.io/auth/google/retorno`
3. Em **Tela de consentimento OAuth**, escopos `email` e `profile` (já são os padrão).

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

### 3. Discord

1. [discord.com/developers/applications](https://discord.com/developers/applications) → sua app →
   **OAuth2**.
2. Em **Redirects**: `https://pokeidle.io/auth/discord/retorno`
3. Escopos usados: `identify email`.

```
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
```

### 4. Resend (confirmação de e-mail)

1. [resend.com](https://resend.com) → **Domains** → adicione o domínio e publique os registros
   **SPF e DKIM** que ele pedir. Sem domínio verificado, o e-mail cai em spam ou nem sai.
2. **API Keys** → crie uma com permissão de envio.

```
RESEND_API_KEY=re_...
RESEND_DE=Pokéidle <nao-responda@pokeidle.io>
```

**Confirmar o e-mail BLOQUEIA a entrada** — desde que o Resend esteja configurado. Criar conta
devolve "confirme sua caixa" e nem emite sessão; `entrarComSenha` recusa com
`login.confirmeEmail` enquanto `email_ok` for falso. É fricção real e é intencional: sem ela o
e-mail de uma conta é um palpite, e é nele que se apoiam a recuperação de senha e a titularidade
antes de um saque de ORB.

Sem `RESEND_API_KEY`, a trava não existe — a conta entra na hora, como antes. Exigir confirmação
sem ter como confirmar trancaria todo mundo do lado de fora, e em desenvolvimento isso é o jogo
inteiro inacessível.

A tela de "confirme seu e-mail" tem botão de **reenviar**, e ele pede a senha de novo. Sem isso,
qualquer um dispararia e-mail para a caixa de qualquer jogador só sabendo o nick — um canal de
spam de graça, assinado por nós.

---

## Como o fluxo OAuth funciona aqui

É o *authorization code* clássico, **na mesma aba** (popup bloqueado é um botão que não faz nada):

```
/auth/google              302 → Google, levando `state` assinado
                          ↓ o jogador autoriza
/auth/google/retorno      troca `code` por token, lê o perfil,
                          acha ou cria a conta,
                          302 → /?sessao=<base64>
```

O cliente lê `?sessao=`, guarda em `localStorage` e **limpa a barra de endereço** — o token não
fica no histórico nem num link que alguém copie.

O `state` é assinado com o mesmo HMAC da sessão e vale 10 minutos. É a defesa contra CSRF de
login: sem ele, um atacante consegue fazer a vítima terminar um fluxo iniciado por ele e acabar
logada na conta do atacante.

### O nick de quem entra por provedor

O Google devolve "Pedro Henrique", que não passa em `NICK_OK` (3 a 16, letras/números/_).
`nickLivre` limpa o que dá para conseguir criar a conta — mas o resultado é um nome que ninguém
escolheu, e o nick é a identidade pública do jogador no chat, no ranking e no Mercado.

Por isso a conta de provedor nasce com **`nick_ok = false`**, e o cliente pergunta o nick
**antes de abrir o socket** (`POST /auth/nick`). Antes do socket, e não dentro do jogo, porque o
nick É a chave da conexão: conectar primeiro criaria o `players` com o nome errado, e aí não
haveria mais o que escolher.

`escolherNick` só vale enquanto `nick_ok` é falso. Depois disso, trocar de nome é o produto pago
da loja — deixar a rota aberta daria de graça o que lá custa 6 ORBs.

A coluna nasce com DEFAULT `true`: contas que já existiam quando ela foi criada já vinham
jogando com o nick delas, e perguntar de novo seria oferecer a troca de um nome que os outros já
conhecem.

### Um pedido de troca de senha por hora

`/auth/recuperar` recusa com `conta.senhaEspere` (e o tempo que falta, em ms) se já houver um
token de senha vivo. Sai de graça do que já existia: um token de senha vale exatamente 1 hora,
então *"existe token vivo"* É *"pediu na última hora"* — sem coluna nova, sem balde em memória, e
sobrevive a restart do servidor (que é o que um balde em memória não faz).

O balde por IP do topo do arquivo não serve aqui: ele conta tentativas de login de uma máquina, e
o que precisa ser segurado é o volume de e-mail que sai em nome de **uma pessoa**.

`trocarSenha` queima os tokens pendentes, então quem completou a troca não fica preso pelo resto
da hora.

### Ligar Google a uma conta que já existe

`entrarComProvedor` procura em duas etapas: primeiro pelo par `(provedor, id de lá)`, que é
estável; **só depois** pelo e-mail. O segundo passo é o que liga um login de Google a uma conta
local que já usava aquele e-mail — sem ele, quem criou conta com senha e depois clicou em
"Login com Google" ganharia uma segunda conta e perderia o personagem.

---

## Uma caixa de e-mail, uma conta (só para contas novas)

O Gmail ignora os pontos do nome e tudo depois de um `+`. Antes disto, `pedro@gmail.com`,
`p.e.d.r.o@gmail.com` e `pedro+1@gmail.com` eram **três contas** e caíam todas na mesma caixa —
todas confirmáveis, todas dentro da lista de domínios. Uma caixa de Gmail valia contas
infinitas, e sem precisar trocar de IP nenhum.

`accounts.email_canon` guarda o endereço reduzido à caixa que ele realmente atinge
([shared/email-canonico.mjs](src/shared/email-canonico.mjs)), e um índice UNIQUE **parcial**
(`WHERE email_canon IS NOT NULL`) impede a repetição.

**Vale só daqui para a frente.** As contas que já existiam ficam com `email_canon` nulo, fora do
índice: nenhuma é tocada, nenhuma colisão antiga precisa ser resolvida à mão, e a migração não
pode derrubar o boot por causa de duplicata histórica. O preço, dito: uma conta nova ainda
consegue colidir com uma antiga.

A regra é por domínio porque a regra é do provedor: ponto só é decorativo no Gmail (no Outlook e
no iCloud, `joao.silva@` é outra pessoa), `+apelido` cai na caixa base no Gmail/Outlook/iCloud, e
o Yahoo fica de fora dos dois — ele não aceita `+` no nome, então cortar ali não fecharia buraco
e ainda arriscaria juntar caixas diferentes.

O detalhe que quase quebrou o login com Google: `entrarComProvedor` procura pela **caixa**, não
pelo endereço exato. Sem isso, quem tem conta local como `pedro+jogo@gmail.com` e clica em
"Continuar com Google" (`pedro@gmail.com`) não casaria com nada, o código seguiria para o INSERT
e bateria no índice novo — 23505 no meio do fluxo OAuth, que o jogador lê como "login falhou".

## Trocar o e-mail

**Pelo jogador**, em três passos: senha, link para o e-mail ATUAL (autoriza) e link para o e-mail
NOVO (confirma). A troca só vale no terceiro.

**Pelo painel** (Usuários → E-mail, `POST /admin/usuarios/email`, só admin completo): para quem se
cadastrou antes da lista de domínios de [shared/email-cadastro.mjs](src/shared/email-cadastro.mjs).
O login dessas contas recusa o endereço antigo (`exigirEmailPermitido`), então o jogador não
chega à tela de troca, e o passo 2 mandaria o link justamente para a caixa que ele não usa mais.

- `auth.trocarEmailPeloSuporte` aplica na hora: formato estrito, domínio da lista, caixa livre
  (`exigirCaixaLivre` + o 23505 do UPDATE), `email_ok = true`, pendências da troca normal limpas.
  Os links que estavam na caixa antiga (senha, confirmação, troca) morrem, e as sessões caem.
- `admin.trocarEmailUsuario` recusa conta de admin ou de Resolver Auditoria, e recusa mandar para
  qualquer conta um endereço que seja, **ou caia na mesma caixa de**, um desses cargos: o cargo sai
  do e-mail (`ADMIN_EMAILS`, `AUDITORIA_RESOLVER_EMAILS`), então trocar e-mail aqui seria dar ou
  tirar cargo. Um e-mail que case duas contas antigas (só maiúsculas diferentes) é recusado;
  use o nick.
- Fica no Log do jogador (`conta.email_admin`, com o antigo, o novo e quem trocou) e no console.

## De onde cada conta entra

`conta_origens` ([origens-db.mjs](src/server/origens-db.mjs)) carimba IP e id de dispositivo a
cada cadastro e a cada login, uma linha por par `(conta, origem)`. É **só registro** — nada
recusa cadastro nem login.

É de propósito. A regra que se quer um dia ("N contas por máquina") depende de um número, e
escolher esse número sem dado é escolher quantos jogadores legítimos trancar do lado de fora:
operadora móvel põe milhares de assinantes atrás de um IPv4 (CGNAT), e lan house, escola e
república fazem o mesmo em menor escala. Primeiro se mede, depois se decide — a medida aparece
em **Multi-contas** no painel admin.

Quando esse dia chegar, duas regras que já saíram da análise: o limite morde no **cadastro**,
nunca no login (conta que existe entra sempre, e aí o pior caso de um falso positivo é um
aborrecimento em vez de um jogador perdido); e um limite por IP só significa alguma coisa depois
que a origem parar de responder fora do Cloudflare — ver a ressalva em
[ip-cliente.mjs](src/server/ip-cliente.mjs).

## Decisões que valem revisão

**Senha com scrypt do próprio Node** (N=2^15, r=8, p=1), sem dependência nova. É uma KDF de
memória alta, que é o que se quer contra GPU; custa ~100 ms por login e é caro num ataque de
dicionário. Repare no `maxmem: 64 MB` explícito em `auth.mjs`: o teto padrão do Node é 32 MB e
esses parâmetros precisam de 33,5 MB — sem ele, **todo** hash estoura.

**A mesma mensagem para "conta não existe" e "senha errada".** Distinguir as duas entrega de
graça a lista de quem tem conta aqui.

**Rate limit por IP em memória** (12 tentativas/minuto), em `auth-rotas.mjs`. Não substitui um
WAF na frente — é o que segura um script varrendo senhas enquanto o WAF não existe. Por processo,
então um atacante teria de distribuir por N gateways para ganhar N vezes o limite.

---

## WebSocket

No `hello`, o gateway valida o token assinado (`lerSessao`), exige `contaId` e recusa
`provedor === 'guest'`. O nick do token tem de bater com o nick enviado. Sem isso, saber o nick
de alguém não abre mais a sessão dela.

A sessão expira em 30 dias e pode ser revogada pelo servidor (`accounts.sessao_epoca`, ver
`revogarSessoes`): trocar a senha ou o e-mail derruba todas as sessões da conta.
