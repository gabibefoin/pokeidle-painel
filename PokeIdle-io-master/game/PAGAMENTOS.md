# Pagamentos — comprar DIAMANTES com PIX e cartão

O jogo tem duas moedas pagas, e elas não se misturam:

| | Diamante 💎 | Gema 💎 |
|---|---|---|
| entra por | **PIX (Efí)** ou **cartão (Stripe)** | depósito de USDT (Solana) |
| gasta em | **Loja** (VIP, boost, outfit, bolas) | **Mercado da Comunidade** |
| sai | não sai — é consumo | saca em USDT |
| contabilidade | receita | passivo |

Este documento é só do **diamante**. A gema está em `ARQUITETURA.md` e `src/server/game/orbs.mjs`.

---

## O que fazer na Stripe (cartão)

1. [dashboard.stripe.com](https://dashboard.stripe.com) → **Desenvolvedores → Chaves de API**.
   Copie a **chave secreta**. Comece com a de teste (`sk_test_…`); a de produção é `sk_live_…`.

   ```
   STRIPE_SECRET_KEY=sk_test_...
   ```

2. **Desenvolvedores → Webhooks → Adicionar endpoint**:

   ```
   https://SEU-DOMINIO/webhooks/stripe
   ```

   Em "eventos a escutar", marque **`checkout.session.completed`** — só esse. Qualquer outro
   evento é respondido com `200` e ignorado, então marcar mais só gera tráfego à toa.

3. Ainda na tela do endpoint, revele o **signing secret** (`whsec_…`):

   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

   **Sem essa variável o webhook é recusado**, de propósito: é a assinatura HMAC do corpo cru
   que prova que o pedido veio da Stripe e não de alguém que descobriu a URL.

4. A conta precisa aceitar **BRL**. O checkout é criado em `brl` e o crédito recusa qualquer
   outra moeda (`creditar` em `diamantes-rotas.mjs`).

### Cartões de teste

Com `sk_test_`, use `4242 4242 4242 4242`, qualquer validade futura e qualquer CVC.

---

## O que fazer na Efí (PIX)

A API Pix da Efí autentica diferente das outras duas: **toda** chamada — inclusive a troca do
token — exige um certificado de cliente (mTLS), não só um par client_id/secret.

1. [sejaefi.com.br](https://sejaefi.com.br) → área de desenvolvedores → crie uma aplicação Pix
   e baixe o **certificado** dela (`.p12`). Guarde o arquivo FORA do controle de versão — o
   `.gitignore` já recusa `certs/`, `*.p12` e `*.pfx`, mas o arquivo tem de existir em algum
   lugar do disco do servidor.

   ```
   EFI_CLIENT_ID=...
   EFI_CLIENT_SECRET=...
   EFI_CERTIFICADO=./certs/efi-producao.p12
   EFI_CERTIFICADO_SENHA=          # só se o .p12 tiver sido gerado com senha
   ```

2. **Chave Pix** que vai receber o dinheiro — a que estiver ativa na conta Efí (CNPJ, e-mail,
   telefone ou aleatória):

   ```
   EFI_CHAVE_PIX=...
   ```

3. **Segredo do webhook** — escolha uma string aleatória e ponha em:

   ```
   EFI_WEBHOOK_SEGREDO=...
   ```

   Ao contrário do LivePix, esta variável é **OBRIGATÓRIA**, não opcional: o corpo que a Efí
   manda não carrega identificador nenhum do nosso app (só a chave Pix, que é informação
   pública), então o segredo na URL é a ÚNICA barreira antes da consulta à API deles. Sem ele,
   `pixAtivo()` volta `false` e a compra por PIX some da Loja.

4. **Cadastrar a URL do webhook.** Diferente do Stripe e do LivePix, a Efí não tem esse campo
   no painel — é uma chamada de API. Depois de preencher as três variáveis acima, rode:

   ```bash
   node tools/efi-configurar-webhook.mjs
   ```

   Isto registra `<URL_PUBLICA>/webhooks/efi/<EFI_WEBHOOK_SEGREDO>` na Efí. Rode de novo sempre
   que `URL_PUBLICA` mudar (primeiro deploy, troca de domínio).

---

## Por que o crédito nunca sai do corpo do webhook

Nos dois provedores, o webhook é só o **gatilho**. O valor pago é sempre reconferido:

- **Stripe** — pela assinatura HMAC do corpo cru (`verificarWebhookStripe`), com janela de
  5 minutos contra replay.
- **Efí** — por uma consulta de volta à API deles (`consultarPix`, autenticada com o mesmo
  certificado mTLS). A Efí não assina o corpo do webhook, então mesmo que alguém adivinhasse o
  segredo e forjasse um "pago", a cobrança forjada continuaria `ATIVA` na consulta de verdade —
  e nada seria creditado.

Creditar a partir do que o JSON diz seria entregar diamante para quem souber o formato.

## Se o webhook se perder

Não trava nada. O gateway pergunta ao provedor, **de minuto em minuto**, se algum pagamento
pendente das últimas 24 h já foi pago (`reconciliarPendentes`). O webhook só torna a entrega
mais rápida — deploy no meio da compra, DNS oscilando ou um 500 nosso viram, no pior caso, um
minuto de espera em vez de um ticket de suporte.

O crédito é **idempotente**: ele só acontece na transição `pendente → pago`, feita com
`WHERE status = 'pendente'`. Webhook reenviado, webhook e reconciliação chegando juntos, dois
gateways processando o mesmo evento — só o primeiro `UPDATE` encontra a linha. `teste-diamantes.mjs`
cobre os três casos, inclusive três confirmações em paralelo.

## Como o diamante chega ao jogador

O webhook bate num **gateway**, que não tem a memória do jogador (ela vive no *sim* dono do
shard). Por isso o gateway credita no **ledger** e deixa a linha marcada como não entregue; o
sim recolhe no login e a cada 15 s e só atualiza o cache da tela. É a mesma caixa postal que o
Mercado da Comunidade já usa para pagar vendedor offline. Detalhes em `diamantes-db.mjs`.

Consequência prática: **`players.diamonds` NÃO passa pelo `flushJogadores`**. Se alguém puser a
coluna de volta naquele `UPDATE`, o flush vai gravar o cache por cima de um crédito recém-pago.
`teste-diamantes.mjs` tem uma conferência de auditoria que pega exatamente isso.

---

## Dados do tomador (nota fiscal)

Toda compra precisa virar NFS-e de serviço, que identifica o **tomador**. Três campos em
`diamante_pagamentos`, de três fontes diferentes:

| campo | de onde vem | quando |
|---|---|---|
| `tomador_cpf` | o jogador digita no checkout — **só no PIX** | `/diamantes/comprar` (validado por `cpfValido`; no cartão fica `null`) |
| `tomador_email` | a conta logada (`jogadorDaSessao`) | `/diamantes/comprar` |
| `tomador_nome` | provedor: Stripe `customer_details.name` / Efí `gnExtras.pagador.nome` | no crédito (`confirmarPagamento`, via `COALESCE` — não sobrescreve) |

O CPF é o único que o jogador redigita: nem o Stripe nem a Efí devolvem o CPF em claro (a Efí
manda mascarado). Ele só é pedido no **PIX** — no cartão o pagador costuma ser estrangeiro (sem
CPF), então exigir travaria a compra; a tela revela a caixinha do CPF no primeiro clique em
"Pagar com PIX". O nome da Efí só existe no **corpo do webhook**, não na consulta — por isso a
rota do webhook lê `pix[0].gnExtras.pagador.nome` e cola no `pago` antes de creditar.

A emissão em si não é automática: o painel de admin tem a aba **Emissão de Notas**
(`admin.emissaoNotas` / `admin.exportarNotas`), que exporta as compras confirmadas por
competência (CSV ou XML) para importar na contabilidade. O marco é o **1º pagamento pela Efí**
(antes dele a receita caía em conta pessoa física): entram **Efí + Stripe** a partir dessa
data/hora, LivePix nunca entra. O valor da nota é o **líquido** recebido (bruto − taxa do
provedor); bruto e taxa também vão no arquivo.

---

## Testar na sua máquina

Os dois provedores precisam **alcançar o seu servidor**, então `localhost` não serve para o
webhook. Suba um túnel e aponte as URLs para ele:

```bash
cloudflared tunnel --url http://localhost:8080
# ou
ngrok http 8080
```

Ponha a URL do túnel em `URL_PUBLICA` (é dela que saem os `success_url`/`cancel_url`), cadastre
o webhook do Stripe manualmente no dashboard deles e rode `node tools/efi-configurar-webhook.mjs`
para cadastrar o da Efí, e reinicie.

No boot o servidor diz o que está ligado:

```
[diamantes] compra ativa · PIX (Efí), cartão (Stripe)
[diamantes] compra DESLIGADA (sem provedor configurado)
```

**As duas integrações são independentes.** Dá para subir com só uma; a tela esconde o botão da
que faltar. Sem nenhuma, a compra some da Loja e o resto do jogo segue igual — é o estado
padrão em desenvolvimento.

---

## Preço

Tabela por faixa de quantidade, em `src/server/game/diamantes.mjs`:

| quantidade | por diamante |
|---|---|
| 1 – 99 | R$ 0,44 |
| 100 – 149 | R$ 0,42 |
| 150 – 199 | R$ 0,40 |
| 200 + | R$ 0,38 |

Compra mínima **R$ 1,00** (3 diamantes) — o piso do Stripe em BRL é R$ 0,50; a Efí aceita
qualquer valor com centavos, então quem fixa o mínimo aqui é o produto, não o provedor.

O preço de uma quantidade nunca é maior que o de comprar até o próximo corte: sem esse teto,
99 diamantes custariam R$ 43,56 e 100 custariam R$ 42,00, ou seja, menos por mais. Quem pede 99
paga os R$ 42,00 e leva 99. `teste-diamantes.mjs` fecha isso com uma varredura de 3.000
quantidades conferindo que o total nunca cai.

**Quem cobra é o servidor.** O cliente manda só a quantidade; o preço é recalculado do zero em
`precoEmCentavos`. Um total adulterado na tela não vira desconto.
